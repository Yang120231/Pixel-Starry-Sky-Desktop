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
