// 后台子智能体：Agent 工具马上返回「已在后台启动」，那一行要等子智能体真正结束才收尾
import { describe, expect, it } from 'vitest'
import { emptySnapshot, reduce, type EngineEvent, type Item, type SessionRecord } from '@pixelsky/protocol'
import { ClaudeTranslator } from '../src/claude/translate'

function make() {
  const events: EngineEvent[] = []
  const t = new ClaudeTranslator('D:\work', {
    emit: e => events.push(e),
    sessionId: () => {},
    permissionMode: () => {},
    turnEnded: () => {},
    fastState: () => {},
  })
  const row = (id: string): Item | undefined =>
    events
      .filter(e => (e.type === 'item_started' || e.type === 'item_completed') && e.item.id === id)
      .map(e => (e.type === 'item_started' || e.type === 'item_completed' ? e.item : null))
      .at(-1) ?? undefined
  return { t, events, row }
}

const launch = (t: ClaudeTranslator) => {
  t.handle({
    type: 'assistant',
    message: {
      id: 'm1',
      model: 'opus',
      content: [
        { type: 'tool_use', id: 'agent-1', name: 'Agent', input: { description: '查超时', run_in_background: true } },
      ],
    },
  })
  t.handle({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'agent-1', content: 'Async agent launched successfully.' }],
    },
    tool_use_result: { isAsync: true, status: 'async_launched', agentId: 'a1', description: '查超时' },
  })
  t.handle({
    type: 'system',
    subtype: 'task_started',
    task_id: 'a1',
    task_type: 'local_agent',
    description: '查超时',
    tool_use_id: 'agent-1',
  })
}

describe('后台子智能体的 Agent 工具行', () => {
  it('启动后保持运行中（后台），这一轮结束也不收尾；子智能体结束时按它的结果收尾', () => {
    const { t, events, row } = make()
    t.startTurn('turn-1')
    launch(t)
    expect(row('agent-1')).toMatchObject({ status: 'running', background: true })
    t.handle({ type: 'result', subtype: 'success', modelUsage: {} })
    const record = { id: 's', engine: 'claude' } as SessionRecord
    const snap = events.reduce(reduce, emptySnapshot(record))
    expect(snap.items.find(i => i.id === 'agent-1')).toMatchObject({ status: 'running' })
    t.handle({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'a1',
      status: 'completed',
      summary: '找到了两处超时',
    })
    expect(row('agent-1')).toMatchObject({ status: 'completed', output: '找到了两处超时' })
  })

  it('这一轮结束时后台子智能体还在跑：轮结束带上个数；跑完、进程退出时个数回到 0', () => {
    const { t, events } = make()
    t.startTurn('turn-1')
    launch(t)
    t.handle({ type: 'result', subtype: 'success', modelUsage: {} })
    const counts = () => events.flatMap(e => (e.type === 'background' ? [e.count] : []))
    expect(counts()).toEqual([1])
    expect(events.find(e => e.type === 'turn_completed')).toMatchObject({ outcome: 'completed', background: 1 })
    // CLI 的后台任务列表也报了它：不重复算
    t.handle({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: 'a1', task_type: 'local_agent', description: '查超时' },
        { task_id: 'b1', task_type: 'local_bash', description: 'npm run dev' },
      ],
    })
    expect(counts()).toEqual([1])
    t.handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'completed', summary: '' })
    t.handle({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'b1', task_type: 'local_bash', description: 'npm run dev' }],
    })
    // 后台命令（开发服务器）不算：跑完会叫醒主线的才算
    expect(counts()).toEqual([1, 0])
    t.startTurn('turn-2')
    t.handle({ type: 'result', subtype: 'success', modelUsage: {} })
    expect(events.filter(e => e.type === 'turn_completed').at(-1)).not.toHaveProperty('background')
    const gone = make()
    gone.t.startTurn('turn-1')
    launch(gone.t)
    gone.t.processGone()
    expect(gone.events.flatMap(e => (e.type === 'background' ? [e.count] : []))).toEqual([1, 0])
  })

  it('失败的子智能体标失败，进程退出时还没结束的标已中断', () => {
    const failed = make()
    failed.t.startTurn('turn-1')
    launch(failed.t)
    failed.t.handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'failed', summary: '' })
    expect(failed.row('agent-1')).toMatchObject({ status: 'failed' })
    const gone = make()
    gone.t.startTurn('turn-1')
    launch(gone.t)
    gone.t.processGone()
    expect(gone.row('agent-1')).toMatchObject({ status: 'interrupted' })
  })
})

describe('后台任务结束提示的结构化信息（docs/ui/subagent-box.md §4.4）', () => {
  const notices = (events: EngineEvent[]) =>
    events.flatMap(e => (e.type === 'item_completed' && e.item.kind === 'notice' ? [e.item] : []))
  const background = (t: ClaudeTranslator, kind: string) =>
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: 'a1',
      task_type: kind,
      description: '查超时',
      tool_use_id: 'agent-1',
      is_backgrounded: true,
    })

  it('后台子智能体完成：text 照旧，带 task（toolUseId、kind、status、label、summary）', () => {
    const { t, events } = make()
    t.startTurn('turn-1')
    background(t, 'local_agent')
    t.handle({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'a1',
      status: 'completed',
      summary: '找到了两处',
    })
    expect(notices(events)).toMatchObject([
      {
        level: 'info',
        text: '子智能体已完成：找到了两处',
        task: { toolUseId: 'agent-1', kind: 'agent', status: 'completed', label: '查超时', summary: '找到了两处' },
      },
    ])
  })

  it('失败是 warn；被停止或别的结束状态记成 stopped；没有摘要时不带 summary', () => {
    const failed = make()
    failed.t.startTurn('turn-1')
    background(failed.t, 'local_workflow')
    failed.t.handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'failed', summary: '' })
    const [warn] = notices(failed.events)
    expect(warn).toMatchObject({ level: 'warn', task: { kind: 'workflow', status: 'failed' } })
    expect(warn.kind === 'notice' && warn.task).not.toHaveProperty('summary')
    const killed = make()
    killed.t.startTurn('turn-1')
    background(killed.t, 'local_bash')
    killed.t.handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'killed', summary: '' })
    expect(notices(killed.events)).toMatchObject([{ task: { kind: 'bash', status: 'stopped' } }])
  })

  it('认不出的任务类型不带 task，界面照旧显示文字', () => {
    const { t, events } = make()
    t.startTurn('turn-1')
    background(t, 'something_new')
    t.handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'completed', summary: '好了' })
    const [notice] = notices(events)
    expect(notice).toMatchObject({ text: '后台任务已完成：好了' })
    expect(notice).not.toHaveProperty('task')
  })
})

describe('停止时连同后台子智能体（translate）', () => {
  const started = (t: ClaudeTranslator, id: string, bg?: boolean, kind = 'local_agent') =>
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: id,
      task_type: kind,
      description: id === 'a1' ? '甲' : '乙',
      ...(bg === undefined ? {} : { is_backgrounded: bg }),
    })
  const subs = (events: EngineEvent[]) => {
    const last = events.filter(e => e.type === 'subagents').at(-1)
    return last && last.type === 'subagents' ? last.subagents : []
  }
  const notices = (events: EngineEvent[]) =>
    events.flatMap(e => (e.type === 'item_completed' && e.item.kind === 'notice' ? [e.item.text] : []))

  it('后台启动的带 background，前台的不带，task_updated 转后台后补上', () => {
    const { t, events } = make()
    t.startTurn('turn-1')
    started(t, 'a1', true)
    started(t, 'a2', false)
    expect(subs(events).map(s => s.background)).toEqual([true, undefined])
    t.handle({ type: 'system', subtype: 'task_updated', task_id: 'a2', patch: { is_backgrounded: true } })
    expect(subs(events).map(s => s.background)).toEqual([true, true])
  })

  it('backgroundTargets 合并子智能体条和后台任务列表', () => {
    const { t } = make()
    t.startTurn('turn-1')
    started(t, 'a1', true)
    t.handle({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: 'a1', task_type: 'local_agent', description: '甲' },
        { task_id: 'w1', task_type: 'local_workflow', description: '编排' },
        { task_id: 'b1', task_type: 'local_bash', description: 'dev' },
      ],
    })
    expect(t.backgroundTargets()).toEqual([
      { id: 'a1', label: '甲', kind: 'agent' },
      { id: 'w1', label: '编排', kind: 'workflow' },
    ])
  })

  it('muteStopNotices：静音的 stopped 通知不提示，状态照样更新；没静音的照常提示', () => {
    const { t, events } = make()
    t.startTurn('turn-1')
    started(t, 'a1', true)
    started(t, 'a2', true)
    t.muteStopNotices(['a1'])
    for (const id of ['a1', 'a2'])
      t.handle({ type: 'system', subtype: 'task_notification', task_id: id, status: 'stopped', summary: '' })
    expect(subs(events).map(s => s.status)).toEqual(['stopped', 'stopped'])
    expect(notices(events)).toEqual(['子智能体已停止'])
  })

  it('stoppedWithMain 的文案', () => {
    const { t, events } = make()
    t.stoppedWithMain(['甲', '乙'])
    expect(notices(events)).toEqual(['已停止，连同 2 个后台子智能体（甲、乙）'])
  })
})
