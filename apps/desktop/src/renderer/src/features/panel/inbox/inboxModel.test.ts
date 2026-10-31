import { describe, expect, it } from 'vitest'
import type { ApprovalRequest, SessionSnapshot, SessionSummary } from '@pixelsky/protocol'
import { buildInbox, canAnswerInline, canResume } from './inboxModel'

const summary = (
  id: string,
  patch: Partial<SessionSummary['record']> = {},
  state: SessionSummary['state'] = 'idle',
  queue?: SessionSummary['queue'],
): SessionSummary => ({
  record: {
    id,
    projectId: 'p',
    title: id,
    updatedAt: 10,
    lastOutcome: null,
    archivedAt: null,
    ...patch,
  } as SessionSummary['record'],
  state,
  ...(queue ? { queue } : {}),
})
const request = (patch: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  requestId: 'r1',
  itemId: null,
  kind: 'command',
  title: '运行命令',
  command: 'npm test',
  alwaysScopes: [],
  ...patch,
})
const snapshot = (pending: ApprovalRequest[]) => ({ pending }) as unknown as SessionSnapshot
const build = (
  sessions: SessionSummary[],
  extra: {
    snapshots?: Record<string, SessionSnapshot>
    dismissed?: Record<string, string>
    machine?: (id: string) => boolean
  } = {},
) =>
  buildInbox({
    sessions,
    snapshots: extra.snapshots ?? {},
    projects: [{ id: 'p', name: '项目', path: 'x', addedAt: 0 }],
    onMachine: extra.machine ?? (() => true),
    dismissed: extra.dismissed ?? {},
  })

describe('待处理分栏', () => {
  it('等你处理 > 出错 > 已暂停，每个会话只出现一次；运行中、正常、归档的不出现', () => {
    const items = build([
      summary('ok', { lastOutcome: 'completed' }),
      summary('running', {}, 'running'),
      summary('paused', { updatedAt: 30 }, 'idle', { queued: 2, failed: 0, paused: true }),
      summary('failed', { lastOutcome: 'failed', lastError: '额度不足', updatedAt: 5 }, 'idle', {
        queued: 0,
        failed: 1,
        paused: true,
      }),
      summary('waiting', { lastOutcome: 'failed' }, 'waiting'),
      summary('archived', { lastOutcome: 'failed', archivedAt: 1 }),
      summary('empty-queue', {}, 'idle', { queued: 0, failed: 0, paused: true }),
    ])
    expect(items.map(i => [i.sessionId, i.lane])).toEqual([
      ['waiting', 'waiting'],
      ['failed', 'failed'],
      ['paused', 'paused'],
    ])
    expect(items[1]).toMatchObject({ error: '额度不足', project: '项目' })
  })
  it('「对话」的项目名写对话；已移除的项目留空', () => {
    const items = build([
      summary('chat', { projectId: 'chat' }, 'waiting'),
      summary('gone', { projectId: 'gone', updatedAt: 5 }, 'waiting'),
    ])
    expect(items.map(i => [i.sessionId, i.project])).toEqual([
      ['chat', '对话'],
      ['gone', ''],
    ])
  })
  it('等限流恢复自动继续的会话（有 limitAt）不算出错；已暂停的照旧', () => {
    const items = build([
      summary('wait', { lastOutcome: 'failed' }, 'idle', { queued: 1, failed: 0, paused: false, limitAt: 5_000 }),
      summary('stopped', { lastOutcome: 'failed' }, 'idle', { queued: 1, failed: 0, paused: true }),
    ])
    expect(items.map(i => [i.sessionId, i.lane])).toEqual([['stopped', 'failed']])
  })
  it('只显示当前机器的会话，同一栏按更新时间倒序', () => {
    const items = build(
      [
        summary('a', { lastOutcome: 'failed', updatedAt: 1 }),
        summary('b', { lastOutcome: 'failed', updatedAt: 9 }),
        summary('ssh-x~c', { lastOutcome: 'failed' }),
      ],
      { machine: id => !id.startsWith('ssh-') },
    )
    expect(items.map(i => i.sessionId)).toEqual(['b', 'a'])
  })
  it('标记已处理后隐藏，状态签名变了重新出现', () => {
    const failed = summary('f', { lastOutcome: 'failed', updatedAt: 10 })
    expect(build([failed], { dismissed: { f: 'f:10' } })).toEqual([])
    expect(build([summary('f', { lastOutcome: 'failed', updatedAt: 11 })], { dismissed: { f: 'f:10' } })).toHaveLength(
      1,
    )
    const waiting = summary('w', {}, 'waiting')
    const [item] = build([waiting], { snapshots: { w: snapshot([request()]) } })
    expect(item).toMatchObject({ signature: 'w:r1', request: { requestId: 'r1' } })
    expect(build([waiting], { snapshots: { w: snapshot([request()]) }, dismissed: { w: 'w:r1' } })).toEqual([])
    expect(
      build([waiting], { snapshots: { w: snapshot([request({ requestId: 'r2' })]) }, dismissed: { w: 'w:r1' } }),
    ).toHaveLength(1)
  })
  it('命令类审批可以直接允许；提问、计划、表单、不允许批准的要去会话；有排队才能继续', () => {
    expect(canAnswerInline(request())).toBe(true)
    expect(canAnswerInline(request({ kind: 'file_change' }))).toBe(true)
    expect(canAnswerInline(request({ kind: 'question' }))).toBe(false)
    expect(canAnswerInline(request({ kind: 'plan' }))).toBe(false)
    expect(canAnswerInline(request({ formSchema: {} }))).toBe(false)
    expect(canAnswerInline(request({ canAllow: false }))).toBe(false)
    expect(canAnswerInline(null)).toBe(false)
    expect(canResume({ queued: 1, failed: 1, paused: true })).toBe(true)
    expect(canResume({ queued: 0, failed: 1, paused: true })).toBe(false)
    expect(canResume({ queued: 1, failed: 0, paused: false })).toBe(false)
  })
})
