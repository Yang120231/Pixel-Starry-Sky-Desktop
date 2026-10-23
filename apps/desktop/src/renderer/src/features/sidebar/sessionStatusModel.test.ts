import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '@pixelsky/protocol'
import type { SessionPr } from '../../../../shared/types/session-status'
import {
  cardActions,
  ciFailed,
  iconPrs,
  prIconHidden,
  statusOf,
  topicOf,
  visiblePrs,
  type CardActionId,
  type StatusInput,
  type StatusKind,
} from './sessionStatusModel'
import { DEFAULT_PR_DISPLAY, parsePrDisplay, type PrDisplay } from './prDisplay'

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

  it('PR 不占左边格子', () => {
    expect(markOf({})).toBeNull()
    expect(markOf({ prs: [pr()] })).toBeNull()
    expect(markOf({ prs: [pr({ conflict: true })] })).toBeNull()
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

  it('一层一层剥开：等你 > 出错类 > 文件夹没了 > 繁忙 > 连不上 > 暂停 > 在跑 > 新回复', () => {
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
    expect(markOf({ ...online, running: false, unread: false })).toBeNull()
  })

  it('文件夹没了排在连不上前面，出错类排在文件夹前面，繁忙排在连不上前面', () => {
    expect(markOf({ folderMissing: true, machine: ssh })).toBe('folder')
    expect(markOf({ folderMissing: true, card: failed('余额不足') })).toBe('balance')
    expect(markOf({ machine: ssh, card: failed('429') })).toBe('busy')
  })
})

describe('statusOf：PR 图标', () => {
  it('一律放右边', () => {
    const s = statusOf({ ...base, prs: [pr()] })
    expect(s.mark).toBeNull()
    expect(s.pr?.number).toBe(1)
    expect(s.prInline).toBe(true)
    expect(statusOf({ ...base, card: failed('boom'), prs: [pr()] }).prInline).toBe(true)
    expect(statusOf({ ...base, running: true, prs: [pr()] }).prInline).toBe(true)
  })

  it('没有 PR 不放', () => {
    expect(statusOf({ ...base, card: failed('boom') }).prInline).toBe(false)
    expect(statusOf({ ...base, card: failed('boom') }).pr).toBeNull()
  })

  it('取第一个（主进程排好了最需要看的）', () => {
    const s = statusOf({ ...base, prs: [pr({ number: 7, state: 'draft' }), pr({ number: 8 })] })
    expect(s.pr?.number).toBe(7)
  })

  it('查不到状态（unknown）也出图标', () => {
    expect(statusOf({ ...base, prs: [pr({ unknown: true })] }).pr?.unknown).toBe(true)
  })
})

describe('PR 图标显示多久、显示哪些', () => {
  const now = Date.parse('2026-10-16T00:00:00Z')
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString()
  const display = (extra: Partial<PrDisplay> = {}): PrDisplay => ({ ...DEFAULT_PR_DISPLAY, ...extra })
  const icon = (p: SessionPr, d: PrDisplay = display(), sessionId = 's1') =>
    statusOf({ ...base, prs: [p], display: d, sessionId, now }).pr?.number ?? null

  it('默认：合并、关闭后显示 1 天；开着、草稿一直显示', () => {
    expect(icon(pr({ state: 'merged', closedAt: ago(20) }))).toBe(1)
    expect(icon(pr({ state: 'merged', closedAt: ago(30) }))).toBeNull()
    expect(icon(pr({ state: 'closed', closedAt: ago(30) }))).toBeNull()
    expect(icon(pr({ state: 'merged', closedAt: null }))).toBeNull()
    expect(icon(pr({ state: 'draft' }))).toBe(1)
    expect(icon(pr())).toBe(1)
  })

  it('合并、关闭后：不显示 / 7 天 / 一直', () => {
    const merged = pr({ state: 'merged', closedAt: ago(3 * 24) })
    expect(icon(merged, display({ doneDays: 0 }))).toBeNull()
    expect(icon(pr({ state: 'merged', closedAt: ago(1) }), display({ doneDays: 0 }))).toBeNull()
    expect(icon(merged, display({ doneDays: 7 }))).toBe(1)
    expect(icon(pr({ state: 'merged', closedAt: ago(30 * 24) }), display({ doneDays: -1 }))).toBe(1)
  })

  it('开着的只显示要处理的：检查没过、有冲突', () => {
    const d = display({ openMode: 'attention' })
    expect(icon(pr(), d)).toBeNull()
    expect(icon(pr({ state: 'draft' }), d)).toBeNull()
    expect(icon(pr({ ci: 'fail' }), d)).toBe(1)
    expect(icon(pr({ conflict: true }), d)).toBe(1)
    expect(icon(pr({ conflict: true, unknown: true }), d)).toBeNull()
  })

  it('隐藏的 PR（不分大小写）、不显示 PR 图标的对话', () => {
    expect(icon(pr(), display({ hiddenPrs: ['https://github.com/o/r/pull/1'] }))).toBeNull()
    expect(
      icon(pr({ url: 'https://github.com/O/R/pull/1' }), display({ hiddenPrs: ['https://github.com/o/r/pull/1'] })),
    ).toBeNull()
    expect(icon(pr(), display({ hiddenSessions: ['s1'] }))).toBeNull()
    expect(icon(pr(), display({ hiddenSessions: ['s1'] }), 's2')).toBe(1)
  })

  it('藏起来的跳过，接着看下一个', () => {
    const list = iconPrs(
      [pr({ number: 1 }), pr({ number: 2, url: 'https://github.com/o/r/pull/2' })],
      display({ hiddenPrs: ['https://github.com/o/r/pull/1'] }),
      's1',
      now,
    )
    expect(list.map(p => p.number)).toEqual([2])
  })

  it('图标藏了是哪条规则', () => {
    expect(prIconHidden(pr(), display({ hiddenPrs: ['https://github.com/o/r/pull/1'] }), now)).toBe('hidden')
    expect(prIconHidden(pr({ state: 'merged', closedAt: ago(48) }), display(), now)).toBe('expired')
    expect(prIconHidden(pr(), display({ openMode: 'attention' }), now)).toBe('quiet')
    expect(prIconHidden(pr(), display(), now)).toBeNull()
  })

  it('图标都藏了还算有 PR（悬停卡照样能弹，在卡里恢复）；只是提到的也算', () => {
    const s = statusOf({ ...base, prs: [pr()], display: display({ hiddenSessions: ['s1'] }), sessionId: 's1', now })
    expect(s.pr).toBeNull()
    expect(s.prInline).toBe(false)
    expect(s.hasPrs).toBe(true)
    expect(statusOf({ ...base, mentioned: 3 }).hasPrs).toBe(true)
    expect(statusOf(base).hasPrs).toBe(false)
  })
})

describe('已关闭的 PR 在悬停卡里列多久', () => {
  const now = Date.parse('2026-10-16T00:00:00Z')
  const closedAt = (days: number) => new Date(now - days * 86_400_000).toISOString()

  it('已关闭 7 天内还列，超过就不列；已合并一直列', () => {
    const list = visiblePrs(
      [
        pr({ number: 1, state: 'closed', closedAt: closedAt(9) }),
        pr({ number: 2, state: 'merged', closedAt: closedAt(30) }),
        pr({ number: 3, state: 'closed', closedAt: closedAt(2) }),
      ],
      now,
    )
    expect(list.map(p => p.number)).toEqual([2, 3])
  })

  it('已关闭没写时间 / 时间读不出来的照样列', () => {
    const list = visiblePrs([pr({ state: 'closed', closedAt: null }), pr({ state: 'closed', closedAt: 'x' })], now)
    expect(list).toHaveLength(2)
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
  it('问题类讲问题，有 PR 讲 PR', () => {
    expect(topicOf(statusOf({ ...base, card: failed('boom'), prs: [pr()] }))).toBe('failed')
    expect(topicOf(statusOf({ ...base, prs: [pr()] }))).toBe('pr')
    expect(topicOf(statusOf({ ...base, prs: [pr({ conflict: true })] }))).toBe('pr')
    expect(topicOf(statusOf({ ...base, mentioned: 2 }))).toBe('pr')
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

  it('PR：只有刷新（打开、复制、隐藏在每个 PR 那一行上）', () => {
    expect(cardActions('pr', ctx)).toEqual(['refresh'])
    expect(cardActions('pr-conflict', ctx)).toEqual(['refresh'])
    expect(cardActions('running', ctx)).toEqual([])
  })
})

describe('parsePrDisplay', () => {
  it('读坏的 / 旧的值回到默认，链接转小写', () => {
    expect(parsePrDisplay(null)).toEqual(DEFAULT_PR_DISPLAY)
    expect(parsePrDisplay({ doneDays: 3, openMode: 'x' })).toEqual(DEFAULT_PR_DISPLAY)
    expect(
      parsePrDisplay({ hiddenPrs: ['https://github.com/O/R/pull/1', 5], doneDays: -1, openMode: 'attention' }),
    ).toEqual({
      hiddenPrs: ['https://github.com/o/r/pull/1'],
      hiddenSessions: [],
      doneDays: -1,
      openMode: 'attention',
    })
  })
})
