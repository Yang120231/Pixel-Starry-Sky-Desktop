import { describe, expect, it } from 'vitest'
import type { ChannelMessage } from '../types/channels'
import { channelNeeds } from './needs'
import { alertRulesOf, cleanAlertRules, cleanDigestHour, dangerousCommand } from './alerts'

const task = (id: string, patch: Record<string, unknown>): ChannelMessage =>
  ({
    kind: 'task',
    id,
    channelId: 'c',
    at: 10,
    authorId: 'you',
    assigneeId: 'a',
    title: id,
    status: 'running',
    sessionId: `s-${id}`,
    ...patch,
  }) as ChannelMessage
const msg = (id: string, at: number, patch: Record<string, unknown>): ChannelMessage =>
  ({ kind: 'message', id, channelId: 'c', at, authorId: 'you', text: id, format: 'plain', ...patch }) as ChannelMessage

describe('「需要你」（docs/ui/channels-collab-v2.md §2）', () => {
  const request = { requestId: 'r1', itemId: null, kind: 'command', title: '运行命令', command: 'ls', alwaysScopes: [] }
  const list: ChannelMessage[] = [
    task('wait', { status: 'waiting', request }),
    task('held', { status: 'queued', relay: { chain: 'x', hop: 3, held: 'hops' } }),
    task('fail', { status: 'failed', error: '额度不足', endedAt: 20, round: 2 }),
    task('decide', { status: 'done', decision: '删旧组件吗？', endedAt: 30 }),
    task('answered', { status: 'done', decision: '要不要发版？', endedAt: 30 }),
    msg('reply', 40, { replyToId: 'answered' }),
    task('checks', {
      status: 'done',
      endedAt: 50,
      checks: {
        id: 'k1',
        at: 50,
        status: 'done',
        items: [
          { kind: 'command', label: 'test', command: 'pnpm test', status: 'fail', exitCode: 1, ms: 1, output: '' },
        ],
      },
    }),
    task('run', { status: 'running' }),
    task('queue', { status: 'queued' }),
    msg('p', 60, { authorId: 'a', proposal: { assigneeId: 'b', request: '写文档', state: 'open' } }),
    msg('p2', 61, { authorId: 'a', proposal: { assigneeId: 'b', request: '写文档', state: 'sent' } }),
    msg('al', 70, { authorId: 'system', text: '等太久了', alert: { rule: 'waiting', state: 'open', taskId: 'wait' } }),
  ]

  it('等你确认、接力停下、失败、要你决定（回过的不算）、检查没过、提议、提醒；新的在前', () => {
    const { needs } = channelNeeds([{ id: 'c' }], new Map([['c', list]]), 'you')
    expect(needs.map(n => n.key)).toEqual([
      'alert:al',
      'proposal:p',
      'checks:checks',
      'decision:decide',
      'failed:fail',
      'approval:wait',
      'held:held',
    ])
    expect(needs.find(n => n.kind === 'approval')).toMatchObject({ sig: 'r1', sessionId: 's-wait', request })
    expect(needs.find(n => n.kind === 'alert')).toMatchObject({ rule: 'waiting', sessionId: 's-wait' })
    expect(needs.find(n => n.kind === 'failed')).toMatchObject({ sig: '2', detail: '额度不足' })
    expect(needs.find(n => n.kind === 'checks')).toMatchObject({ sig: 'k1', detail: 'test', findings: 0 })
    expect(needs.find(n => n.kind === 'proposal')).toMatchObject({ memberId: 'b', text: '写文档' })
  })

  it('跟进中是还在排队 / 运行的活（停下的接力和等你确认的不算）；归档的频道不算', () => {
    const { following } = channelNeeds([{ id: 'c' }], new Map([['c', list]]), 'you')
    expect(following.map(f => f.taskId).sort()).toEqual(['queue', 'run'])
    expect(channelNeeds([{ id: 'c', archivedAt: 1 }], new Map([['c', list]]), 'you').needs).toEqual([])
  })
})

describe('主动提醒的规则（§6）', () => {
  it('会丢改动的 git 命令', () => {
    for (const c of [
      'git checkout -- src/a.ts',
      'git checkout main',
      'git -C x reset --hard HEAD',
      'git clean -fd',
      'git stash',
      'git restore .',
    ])
      expect(dangerousCommand(c)).toBe(true)
    for (const c of ['git status', 'git stash list', 'git reset HEAD a.ts', 'git clean -n', 'git switch main', 'ls'])
      expect(dangerousCommand(c)).toBe(false)
  })
  it('没设过按默认；乱写的丢掉；简报钟点 0–23', () => {
    expect(alertRulesOf({})).toEqual({ conflict: true, waiting: true, stalled: true, unclaimed: false, digest: false })
    expect(cleanAlertRules({ digest: true, nope: true, waiting: 'yes' })).toEqual({ digest: true })
    expect(cleanDigestHour(23)).toBe(23)
    expect(cleanDigestHour(24)).toBe(9)
  })
})
