import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '@pixelsky/protocol'
import type { SessionPr } from '../../../../shared/types/session-status'
import {
  cardActions,
  ciFailed,
  statusOf,
  topicOf,
  visiblePrs,
  type CardActionId,
  type StatusInput,
  type StatusKind,
} from './sessionStatusModel'

const request = (kind: ApprovalRequest['kind'], extra: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  requestId: 'r1',
  itemId: null,
  kind,
  title: '请求',
  alwaysScopes: [],
  ...extra,
})
const pr = (extra: Partial<SessionPr> = {}): SessionPr => ({
  repo: 'o/r',
  number: 1,
  url: 'https://github.com/o/r/pull/1',
  title: 't',
  state: 'open',
  ci: 'pass',
  ciFailed: 0,
  conflict: false,
  additions: 1,
  deletions: 0,
  head: 'feat',
  base: 'main',
  closedAt: null,
  ...extra,
})
const waiting = (kind: ApprovalRequest['kind'] | null) => ({
  lane: 'waiting' as const,
  request: kind ? request(kind) : null,
  error: null,
})
const failed = (error: string | null) => ({ lane: 'failed' as const, request: null, error })
const paused = { lane: 'paused' as const, request: null, error: null }
const base: StatusInput = { running: false, unread: false }
const markOf = (input: Partial<StatusInput>): StatusKind | null => statusOf({ ...base, ...input }).mark
const ssh = { kind: 'ssh' as const, status: 'disconnected' as const }

describe('statusOf：每一种', () => {
  it('等你：命令 / 改文件 / 工具是批准，提问 / 计划 / 还没读到请求是回答', () => {
    for (const kind of ['command', 'file_change', 'tool'] as const)
      expect(markOf({ card: waiting(kind) })).toBe('approve')
    for (const kind of ['question', 'plan'] as const) expect(markOf({ card: waiting(kind) })).toBe('question')
    expect(markOf({ card: waiting(null) })).toBe('question')
  })

  it('出错按原因分：登录 / 余额 / 线路 / 繁忙 / 归不了类', () => {
    expect(markOf({ card: failed('登录已失效，请重新登录') })).toBe('auth')
    expect(markOf({ card: failed('余额不足，请充值') })).toBe('balance')
    expect(markOf({ card: failed('找不到所选模型') })).toBe('route')
    expect(markOf({ card: failed('请求太频繁 429') })).toBe('busy')
    expect(markOf({ card: failed('子进程退出了') })).toBe('failed')
    expect(markOf({ card: failed(null) })).toBe('failed')
  })

  it('文件夹没了 / 机器连不上 / 暂停 / 在跑 / 新回复', () => {
    expect(markOf({ folderMissing: true })).toBe('folder')
    expect(markOf({ machine: ssh })).toBe('offline')
    expect(markOf({ machine: { kind: 'wsl', status: 'error' } })).toBe('offline')
    expect(markOf({ card: paused })).toBe('paused')
    expect(markOf({ running: true })).toBe('running')
    expect(markOf({ unread: true })).toBe('unread')
    expect(markOf({ card: { lane: 'unread', request: null, error: null } })).toBe('unread')
  })

  it('机器只有 ssh / wsl 且断开 / 出错才算连不上', () => {
    expect(markOf({ machine: { kind: 'local', status: 'local' } })).toBeNull()
    expect(markOf({ machine: { kind: 'ssh', status: 'connected' } })).toBeNull()
    expect(markOf({ machine: { kind: 'ssh', status: 'connecting' } })).toBeNull()
    expect(markOf({ machine: { kind: 'local', status: 'disconnected' } })).toBeNull()
    expect(markOf({ machine: null })).toBeNull()
  })

  it('PR：开着有冲突是 pr-conflict，其余是 pr；没有就空', () => {
    expect(markOf({})).toBeNull()
    expect(markOf({ prs: [pr()] })).toBe('pr')
    expect(markOf({ prs: [pr({ conflict: true })] })).toBe('pr-conflict')
    // 草稿、已合并带冲突标记不算冲突；查不到状态的也不算
    expect(markOf({ prs: [pr({ state: 'draft', conflict: true })] })).toBe('pr')
    expect(markOf({ prs: [pr({ state: 'merged', conflict: true })] })).toBe('pr')
    expect(markOf({ prs: [pr({ unknown: true, conflict: true })] })).toBe('pr')
  })

  it('文字：问题类写字，其余没有', () => {
    const key = (input: Partial<StatusInput>) => statusOf({ ...base, ...input }).label?.key
    expect(key({ card: waiting('command') })).toBe('sidebar.tree.tag.waiting')
    expect(key({ card: failed('登录已失效') })).toBe('sidebar.tree.tag.auth')
    expect(key({ card: failed('余额不足') })).toBe('sidebar.tree.tag.balance')
    expect(key({ card: failed('找不到所选模型') })).toBe('sidebar.tree.tag.route')
    expect(key({ card: failed('429') })).toBe('sidebar.tree.tag.busy')
    expect(key({ card: failed('boom') })).toBe('sidebar.tree.tag.failed')
    expect(key({ folderMissing: true })).toBe('sidebar.tree.tag.folder')
    expect(key({ machine: { kind: 'ssh', status: 'error' } })).toBe('sidebar.tree.tag.offline')
    expect(key({ card: paused })).toBe('sidebar.tree.tag.paused')
    expect(key({ running: true })).toBeUndefined()
    expect(key({ prs: [pr()] })).toBeUndefined()
  })
})

describe('statusOf：先后', () => {
  const all: StatusInput = {
    running: true,
    unread: true,
    folderMissing: true,
    machine: ssh,
    prs: [pr({ conflict: true })],
  }

  it('一层一层剥开：等你 > 出错类 > 文件夹没了 > 繁忙 > 连不上 > 暂停 > 在跑 > 新回复 > 冲突的 PR', () => {
    expect(markOf({ ...all, card: waiting('command') })).toBe('approve')
    expect(markOf({ ...all, card: failed('登录已失效') })).toBe('auth')
    expect(markOf({ ...all, card: failed('boom') })).toBe('failed')
    // 繁忙排在文件夹没了后面
    expect(markOf({ ...all, card: failed('429') })).toBe('folder')
    const noFolder = { ...all, folderMissing: false }
    expect(markOf({ ...noFolder, card: failed('429') })).toBe('busy')
    expect(markOf({ ...noFolder, card: paused })).toBe('offline')
    const online = { ...noFolder, machine: null }
    expect(markOf({ ...online, card: paused })).toBe('paused')
    expect(markOf(online)).toBe('running')
    expect(markOf({ ...online, running: false })).toBe('unread')
    expect(markOf({ ...online, running: false, unread: false })).toBe('pr-conflict')
  })

  it('文件夹没了排在连不上前面，出错类排在文件夹前面，繁忙排在连不上前面', () => {
    expect(markOf({ folderMissing: true, machine: ssh })).toBe('folder')
    expect(markOf({ folderMissing: true, card: failed('余额不足') })).toBe('balance')
    expect(markOf({ machine: ssh, card: failed('429') })).toBe('busy')
  })
})

describe('statusOf：PR 放左边还是右边', () => {
  it('格子空着放左边（右边不再放）', () => {
    const s = statusOf({ ...base, prs: [pr()] })
    expect(s.mark).toBe('pr')
    expect(s.pr?.number).toBe(1)
    expect(s.prInline).toBe(false)
  })

  it('格子被占了（问题、在跑、新回复）就挪到右边', () => {
    expect(statusOf({ ...base, card: failed('boom'), prs: [pr()] }).prInline).toBe(true)
    expect(statusOf({ ...base, running: true, prs: [pr()] }).prInline).toBe(true)
    expect(statusOf({ ...base, unread: true, prs: [pr()] }).prInline).toBe(true)
    expect(statusOf({ ...base, folderMissing: true, prs: [pr({ state: 'merged' })] }).prInline).toBe(true)
  })

  it('没有 PR 不用挪', () => {
    expect(statusOf({ ...base, card: failed('boom') }).prInline).toBe(false)
    expect(statusOf({ ...base, card: failed('boom') }).pr).toBeNull()
  })

  it('取第一个（主进程排好了最需要看的）', () => {
    const s = statusOf({ ...base, prs: [pr({ number: 7, state: 'draft' }), pr({ number: 8 })] })
    expect(s.pr?.number).toBe(7)
  })
})

describe('已关闭 / 查不到的 PR', () => {
  const now = Date.parse('2026-10-16T00:00:00Z')
  const closedAt = (days: number) => new Date(now - days * 86_400_000).toISOString()

  it('已关闭 7 天内还显示，超过就不显示（回到时间）', () => {
    expect(markOf({ prs: [pr({ state: 'closed', closedAt: closedAt(2) })], now })).toBe('pr')
    expect(markOf({ prs: [pr({ state: 'closed', closedAt: closedAt(8) })], now })).toBeNull()
    expect(
      statusOf({ ...base, running: true, prs: [pr({ state: 'closed', closedAt: closedAt(8) })], now }).prInline,
    ).toBe(false)
  })

  it('已合并一直显示；过期的已关闭被去掉后接着看下一个', () => {
    expect(markOf({ prs: [pr({ state: 'merged', closedAt: closedAt(30) })], now })).toBe('pr')
    const list = visiblePrs(
      [pr({ number: 1, state: 'closed', closedAt: closedAt(9) }), pr({ number: 2, state: 'merged' })],
      now,
    )
    expect(list.map(p => p.number)).toEqual([2])
  })

  it('已关闭没写时间 / 时间读不出来的照样显示', () => {
    const list = visiblePrs([pr({ state: 'closed', closedAt: null }), pr({ state: 'closed', closedAt: 'x' })], now)
    expect(list).toHaveLength(2)
  })

  it('查不到状态（unknown）也是 pr', () => {
    const s = statusOf({ ...base, prs: [pr({ unknown: true })] })
    expect(s.mark).toBe('pr')
    expect(s.pr?.unknown).toBe(true)
  })
})

describe('CI 小红点', () => {
  it('只有开着且检查没过才有', () => {
    expect(ciFailed(pr({ ci: 'fail', ciFailed: 2 }))).toBe(true)
    expect(ciFailed(pr({ ci: 'pass' }))).toBe(false)
    expect(ciFailed(pr({ ci: 'pending' }))).toBe(false)
    expect(ciFailed(pr({ ci: null }))).toBe(false)
    expect(ciFailed(pr({ ci: 'fail', state: 'merged' }))).toBe(false)
    expect(ciFailed(pr({ ci: 'fail', unknown: true }))).toBe(false)
    expect(ciFailed(null)).toBe(false)
  })
})

describe('topicOf：悬停卡讲什么', () => {
  it('问题类讲问题，PR 占着格子讲 PR', () => {
    expect(topicOf(statusOf({ ...base, card: failed('boom'), prs: [pr()] }))).toBe('failed')
    expect(topicOf(statusOf({ ...base, prs: [pr()] }))).toBe('pr')
    expect(topicOf(statusOf({ ...base, prs: [pr({ conflict: true })] }))).toBe('pr-conflict')
  })

  it('只是在跑 / 新回复：没有 PR 不弹，有 PR 讲 PR', () => {
    expect(topicOf(statusOf({ ...base, running: true }))).toBeNull()
    expect(topicOf(statusOf({ ...base, unread: true }))).toBeNull()
    expect(topicOf(statusOf({ ...base, running: true, prs: [pr()] }))).toBe('pr')
    expect(topicOf(statusOf(base))).toBeNull()
  })
})

describe('cardActions：悬停卡的按钮', () => {
  const ctx: { request: ApprovalRequest | null; queue: null; errorActions: CardActionId[] } = {
    request: null,
    queue: null,
    errorActions: [],
  }

  it('等你批准：能就地回答才有允许 / 拒绝；canDeny 为 false 时没有拒绝', () => {
    expect(cardActions('approve', { ...ctx, request: request('command') })).toEqual(['allow', 'deny'])
    expect(cardActions('approve', { ...ctx, request: request('command', { canDeny: false }) })).toEqual(['allow'])
    expect(cardActions('approve', { ...ctx, request: request('command', { formSchema: {} }) })).toEqual([])
    expect(cardActions('approve', ctx)).toEqual([])
    expect(cardActions('question', { ...ctx, request: request('question') })).toEqual([])
  })

  it('出错：登录 / 余额 / 线路取推荐的前两个；繁忙和归不了类先给重试，最多三个', () => {
    expect(cardActions('auth', { ...ctx, errorActions: ['sign-in', 'use-self', 'open-menu'] })).toEqual([
      'sign-in',
      'use-self',
    ])
    expect(cardActions('balance', { ...ctx, errorActions: ['open-account', 'open-menu', 'use-self'] })).toEqual([
      'open-account',
      'open-menu',
    ])
    expect(cardActions('busy', { ...ctx, errorActions: ['edit-provider', 'use-platform'] })).toEqual([
      'retry',
      'edit-provider',
      'use-platform',
    ])
    expect(cardActions('failed', ctx)).toEqual(['retry'])
    expect(cardActions('busy', { ...ctx, errorActions: ['retry', 'open-menu', 'use-self'] })).toEqual([
      'retry',
      'open-menu',
      'use-self',
    ])
  })

  it('文件夹没了归档，连不上重新连接，暂停有排队才能继续', () => {
    expect(cardActions('folder', ctx)).toEqual(['archive'])
    expect(cardActions('offline', ctx)).toEqual(['reconnect'])
    expect(cardActions('paused', { ...ctx, queue: { queued: 2, failed: 0, paused: true } as never })).toEqual([
      'resume',
    ])
    expect(cardActions('paused', { ...ctx, queue: { queued: 0, failed: 1, paused: true } as never })).toEqual([])
  })

  it('PR：浏览器打开、复制链接、刷新', () => {
    expect(cardActions('pr', ctx)).toEqual(['open-pr', 'copy-pr', 'refresh'])
    expect(cardActions('pr-conflict', ctx)).toEqual(['open-pr', 'copy-pr', 'refresh'])
    expect(cardActions('running', ctx)).toEqual([])
  })
})
