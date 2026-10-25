import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@pixelsky/protocol'
import type { ManualTask, TaskSchedule } from '../../../shared/types/project-tools'
import { ScheduleRunner, sessionBusy, type ScheduleDeps } from './schedule-runner'

const at = (day: number, h: number, m = 0): number => new Date(2026, 9, day, h, m).getTime()

function setup(patch: Partial<TaskSchedule> = {}, task: Partial<ManualTask> = {}) {
  const schedule: TaskSchedule = {
    enabled: true,
    freq: 'daily',
    hour: 9,
    minute: 0,
    weekday: 1,
    engine: 'claude',
    model: null,
    permission: 'plan',
    session: 'new',
    lastSlot: at(25, 9),
    runs: [],
    ...patch,
  }
  const t = {
    id: 't1',
    projectId: 'p1',
    title: '依赖检查',
    note: '只列出来',
    schedule,
    link: null,
    ...task,
  } as ManualTask
  const state = {
    now: at(26, 9, 1),
    sessions: [] as SessionSummary[],
    calls: [] as [string, unknown[]][],
    dispatched: [] as unknown[],
  }
  const deps: ScheduleDeps = {
    tasks: {
      all: () => [t],
      mutateSchedule: async (_id, change) => change(t.schedule!),
    },
    call: async (channel, args) => {
      state.calls.push([channel, args])
      return channel === 'engine:createSession' ? { id: 'new-session' } : undefined
    },
    projects: () => [{ id: 'p1' }],
    sessions: () => state.sessions,
    dispatch: async (_c, issue) => (state.dispatched.push(issue), { taskId: 'card-1' }),
    now: () => state.now,
    log: () => {},
  }
  return { runner: new ScheduleRunner(deps), t, state }
}
const summary = (patch: Record<string, unknown> = {}, rest: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    state: 'idle',
    record: { id: 'new-session', updatedAt: at(26, 9, 5), lastOutcome: 'completed', ...patch },
    ...rest,
  }) as SessionSummary
const arg = (call: [string, unknown[]], i: number): unknown => call[1][i]

describe('ScheduleRunner', () => {
  it('到点：新开会话、标题 = 任务标题、提示词 = 备注，带来源任务 id', async () => {
    const { runner, t, state } = setup()
    await runner.tick()
    expect(state.calls.map(c => c[0])).toEqual(['engine:createSession', 'engine:renameSession', 'engine:send'])
    expect(arg(state.calls[0], 0)).toMatchObject({ projectId: 'p1', permissionMode: 'plan', scheduleTaskId: 't1' })
    expect(state.calls[1][1]).toEqual(['new-session', '依赖检查'])
    expect(arg(state.calls[2], 1)).toMatchObject({ text: '只列出来' })
    expect(t.schedule).toMatchObject({ lastSlot: at(26, 9), lastSessionId: 'new-session' })
    expect(t.schedule!.runs[0]).toMatchObject({
      at: at(26, 9),
      trigger: 'schedule',
      status: 'running',
      sessionId: 'new-session',
    })
    await runner.tick() // 同一个时间点不重复运行
    expect(state.calls).toHaveLength(3)
  })
  it('备注是斜杠命令时原样发；没备注用标题', async () => {
    const a = setup({}, { note: '/review' })
    await a.runner.tick()
    expect(arg(a.state.calls[2], 1)).toMatchObject({ text: '/review' })
    const b = setup({}, { note: '' })
    await b.runner.tick()
    expect(arg(b.state.calls[2], 1)).toMatchObject({ text: '依赖检查' })
  })
  it('应用没开错过了：只记「已错过」，不补跑', async () => {
    const { runner, t, state } = setup()
    state.now = at(26, 12)
    await runner.tick()
    expect(state.calls).toHaveLength(0)
    expect(t.schedule!.runs[0]).toMatchObject({ at: at(26, 9), status: 'missed' })
    expect(t.schedule!.lastSlot).toBe(at(26, 9))
  })
  it('暂停时不运行', async () => {
    const { runner, state } = setup({ enabled: false })
    await runner.tick()
    expect(state.calls).toHaveLength(0)
  })
  it('上一次还在跑：跳过并记录', async () => {
    const { runner, t, state } = setup({
      runs: [{ at: at(25, 9), trigger: 'schedule', status: 'running', sessionId: 'new-session' }],
    })
    state.sessions = [summary({}, { state: 'running' })]
    await runner.tick()
    expect(state.calls).toHaveLength(0)
    expect(t.schedule!.runs[0]).toMatchObject({ at: at(26, 9), status: 'skipped' })
  })
  it('会话结束后写上结果；失败带原因', async () => {
    const { runner, t, state } = setup({
      runs: [{ at: at(26, 9), trigger: 'schedule', status: 'running', sessionId: 'new-session' }],
      lastSlot: at(26, 9),
    })
    state.sessions = [summary({ lastReply: '3 个依赖可升级' })]
    await runner.tick()
    expect(t.schedule!.runs[0]).toMatchObject({ status: 'done', note: '3 个依赖可升级', endedAt: at(26, 9, 5) })
    t.schedule!.runs[0].status = 'running'
    state.sessions = [summary({ lastOutcome: 'failed', lastError: '额度用完\n详情' })]
    await runner.tick()
    expect(t.schedule!.runs[0]).toMatchObject({ status: 'failed', note: '额度用完' })
  })
  it('续在上一次的会话里：会话还在就不新开', async () => {
    const { runner, state } = setup({ session: 'resume', lastSessionId: 'old' })
    state.sessions = [summary({ id: 'old' })]
    await runner.tick()
    expect(state.calls.map(c => c[0])).toEqual(['engine:send'])
    expect(arg(state.calls[0], 0)).toBe('old')
  })
  it('交给频道成员：走 dispatchIssue，用卡片判断结束', async () => {
    const { runner, t, state } = setup({}, { assignee: { channelId: 'c1', memberId: 'm1', name: '前端' } })
    await runner.tick()
    expect(state.calls).toHaveLength(0)
    expect(state.dispatched[0]).toMatchObject({ id: 't1', title: '依赖检查', memberId: 'm1' })
    expect(t.schedule!.runs[0]).toMatchObject({ status: 'running', card: { channelId: 'c1', taskId: 'card-1' } })
    t.link = { channelId: 'c1', taskId: 'card-1', state: 'done', round: 1, at: at(26, 9, 8) }
    await runner.tick()
    expect(t.schedule!.runs[0]).toMatchObject({ status: 'done', endedAt: at(26, 9, 8) })
  })
  it('频道卡片等你处理时不算在跑', async () => {
    const { runner, t } = setup({}, { assignee: { channelId: 'c1', memberId: 'm1', name: '前端' } })
    await runner.tick()
    t.link = { channelId: 'c1', taskId: 'card-1', state: 'approval', round: 1, at: at(25, 9, 5) }
    await runner.tick()
    expect(t.schedule!.runs[0]).toMatchObject({ status: 'done', note: '等你处理' })
  })
  it('立即运行：不动 lastSlot；上一次还在跑时报错', async () => {
    const { runner, t, state } = setup()
    await runner.runNow('t1')
    expect(t.schedule!.runs[0]).toMatchObject({ trigger: 'manual', status: 'running' })
    expect(t.schedule!.lastSlot).toBe(at(25, 9))
    state.sessions = [summary({}, { state: 'running' })]
    await expect(runner.runNow('t1')).rejects.toThrow('上一次还在运行')
  })
  it('启动失败：记成失败，仍算这个时间点已处理', async () => {
    const { runner, t } = setup({}, { projectId: 'gone' })
    await runner.tick()
    expect(t.schedule!.runs[0]).toMatchObject({ status: 'failed', note: '项目不存在' })
    expect(t.schedule!.lastSlot).toBe(at(26, 9))
  })
})

describe('sessionBusy', () => {
  it('限流等待恢复（队列里有消息）也算在忙', () => {
    expect(sessionBusy(summary({}, { queue: { queued: 1, failed: 0, paused: false } }))).toBe(true)
    expect(sessionBusy(summary({}, { queue: { queued: 1, failed: 0, paused: true } }))).toBe(false)
    expect(sessionBusy(summary({}, { state: 'waiting' }))).toBe(false)
  })
})
