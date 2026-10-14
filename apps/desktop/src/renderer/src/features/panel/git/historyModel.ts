// 提交历史的显示模型（docs/ui/git-panel.md §9.3）：引用标记、时间、列表里的行（含未拉取 / 未推送两条特殊行）。纯函数。
import { tr } from '@/i18n/core'
import type { GitCommit, GitRefLabel } from '../../../../../shared/types/project-tools'
import { spacerRow, type GraphCommit, type GraphRow, type SyncState } from './graph'

export type BadgeKind = 'current' | 'head' | 'branch' | 'both' | 'remote' | 'tag' | 'base'
/** 标记的颜色跟线走：未推送 / 已推送 / 远程新提交；neutral 是和同步状态无关的（标签、别的分支） */
export type BadgeTone = SyncState | 'neutral'
export interface Badge {
  kind: BadgeKind
  name: string
  tone: BadgeTone
}

const ORDER: BadgeKind[] = ['current', 'head', 'base', 'branch', 'both', 'remote', 'tag']

/** 同名的本地分支和远端分支（origin/x 和 x）合成一个「本地 & 远端」；基础分支单独标；当前分支排最前 */
export function refBadges(
  refs: readonly GitRefLabel[],
  base: string | null,
  /** 这个提交的同步状态和当前分支的上游名：当前分支 / HEAD 的标记用提交的状态色，上游标记（origin/main）用「已推送」色（上游比本地新时用「远程新提交」色） */
  sync?: { state?: SyncState; upstream?: string | null },
): Badge[] {
  const remotes = refs.filter(r => r.kind === 'remote')
  const merged = new Set<string>()
  const badges: Badge[] = []
  const state: BadgeTone = sync?.state ?? 'neutral'
  for (const r of refs) {
    if (r.kind === 'head') badges.push({ kind: 'head', name: 'HEAD', tone: state })
    else if (r.kind === 'tag') badges.push({ kind: 'tag', name: r.name, tone: 'neutral' })
    else if (r.kind === 'branch') {
      const twin = remotes.find(
        x => x.name.endsWith('/' + r.name) && !x.name.slice(0, -r.name.length - 1).includes('/'),
      )
      if (twin) merged.add(twin.name)
      const kind: BadgeKind = r.current ? 'current' : r.name === base ? 'base' : twin ? 'both' : 'branch'
      badges.push({ kind, name: r.name, tone: r.current ? state : 'neutral' })
    }
  }
  for (const r of remotes)
    if (!merged.has(r.name))
      badges.push({
        kind: r.name === base ? 'base' : 'remote',
        name: r.name,
        tone: r.name === sync?.upstream ? (state === 'incoming' ? 'incoming' : 'synced') : 'neutral',
      })
  return badges.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

/** 悬停提示用：某个同步状态对应的文案键 */
export const SYNC_TITLE_KEY = {
  local: 'git.history.sync.local',
  synced: 'git.history.sync.synced',
  incoming: 'git.history.sync.incoming',
} as const satisfies Record<SyncState, string>

/**
 * 当前分支上每个提交的同步状态（docs/ui/git-graph-colors.md §3）：只在已加载的提交里沿父提交走一遍。
 * 从 HEAD 能到、从上游到不了 = local（未推送）；两边都能到 = synced（已推送）；只有上游能到 = incoming（未拉取）。
 * 两边都到不了的提交（别的分支）不在结果里。
 * - upstreamTip 为 null（没有上游，或上游顶端还没加载到）：已加载的 HEAD 可达提交都是 local；给了 ahead 时只把第一父链上的前 ahead 个算 local。
 * - 算出的数量和 ahead / behind 对不上（浅克隆、历史被改写）：退回只按 ahead / behind 沿第一父链标。
 */
export function syncStates(
  commits: readonly GraphCommit[],
  ctx: { head: string | null; upstreamTip: string | null; ahead?: number; behind?: number },
): Map<string, SyncState> {
  const out = new Map<string, SyncState>()
  const byHash = new Map(commits.map(c => [c.hash, c]))
  if (!ctx.head || !byHash.has(ctx.head)) return out
  const reach = (start: string | null): Set<string> => {
    const seen = new Set<string>()
    const stack = start && byHash.has(start) ? [start] : []
    while (stack.length) {
      const h = stack.pop()!
      if (seen.has(h)) continue
      seen.add(h)
      for (const p of byHash.get(h)!.parents) if (byHash.has(p) && !seen.has(p)) stack.push(p)
    }
    return seen
  }
  /** 沿第一父提交走 n 步（跳过 skip 里的） */
  const firstParents = (start: string | null, n: number, skip?: ReadonlySet<string>): Set<string> => {
    const got = new Set<string>()
    let cur = start && byHash.has(start) ? byHash.get(start) : undefined
    while (cur && got.size < n) {
      if (!skip?.has(cur.hash)) got.add(cur.hash)
      cur = byHash.get(cur.parents[0])
    }
    return got
  }
  const headSet = reach(ctx.head)
  const upSet = reach(ctx.upstreamTip)
  const tipLoaded = !!ctx.upstreamTip && upSet.size > 0
  let local = new Set([...headSet].filter(h => !upSet.has(h)))
  let incoming = new Set([...upSet].filter(h => !headSet.has(h)))
  if (!tipLoaded) {
    incoming = new Set()
    // 上游顶端没加载到：已加载的都算未推送；知道 ahead 就只标前 ahead 个，其余是已推送
    if (ctx.ahead !== undefined && ctx.ahead < headSet.size) local = firstParents(ctx.head, ctx.ahead)
    else local = headSet
  } else {
    if (ctx.ahead !== undefined && local.size !== ctx.ahead) local = firstParents(ctx.head, ctx.ahead)
    if (ctx.behind !== undefined && incoming.size !== ctx.behind)
      incoming = firstParents(ctx.upstreamTip, ctx.behind, headSet)
  }
  for (const h of headSet) out.set(h, local.has(h) ? 'local' : 'synced')
  for (const h of incoming) if (!headSet.has(h)) out.set(h, 'incoming')
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** 今天 / 昨天写「今天 13:38」，更早写「2026/10/9 22:48」 */
export function commitTime(at: number, now = Date.now()): string {
  const d = new Date(at),
    today = dayStart(new Date(now))
  if (at >= today) return tr('git.history.today', { time: clock(d) })
  if (at >= today - 86400_000) return tr('git.history.yesterday', { time: clock(d) })
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${clock(d)}`
}

/** 悬停卡片和详情里的完整时间：2026/10/9 22:48:05 */
export function fullTime(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${clock(d)}:${pad(d.getSeconds())}`
}

export const shortHash = (hash: string): string => hash.slice(0, 7)

export type SpecialKind = 'outgoing' | 'incoming'
export type HistoryEntry =
  /** unpublished：分支还没发布（没有上游），整条都是未推送，这一行不能展开比较 */
  | { type: 'special'; kind: SpecialKind; count: number; graph: GraphRow | null; unpublished?: boolean }
  | { type: 'commit'; commit: GitCommit; graph: GraphRow | null; head: boolean }

/**
 * 列表里的行：提交按顺序；没有搜索时在 HEAD 上方插「未推送」、在上游最新提交上方插「未拉取」（参照 VS Code 的 outgoing / incoming）。
 * rows 是分支线（搜索时为 null）。
 */
export function historyEntries(
  commits: readonly GitCommit[],
  rows: readonly GraphRow[] | null,
  ctx: { head: string | null; upstream: string | null; ahead: number; behind: number; unpublished?: boolean },
): HistoryEntry[] {
  const out: HistoryEntry[] = []
  commits.forEach((commit, i) => {
    const graph = rows?.[i] ?? null
    if (rows && !ctx.upstream && ctx.unpublished && commit.hash === ctx.head)
      out.push({ type: 'special', kind: 'outgoing', count: 0, graph: graph && spacerRow(graph), unpublished: true })
    if (rows && ctx.upstream) {
      const special = (kind: SpecialKind, count: number) =>
        out.push({ type: 'special', kind, count, graph: graph && spacerRow(graph) })
      if (ctx.behind > 0 && commit.refs.some(r => r.kind === 'remote' && r.name === ctx.upstream))
        special('incoming', ctx.behind)
      if (ctx.ahead > 0 && commit.hash === ctx.head) special('outgoing', ctx.ahead)
    }
    out.push({ type: 'commit', commit, graph, head: commit.hash === ctx.head })
  })
  return out
}

/** 提交信息全文（复制用） */
export const fullMessage = (c: GitCommit): string => (c.body ? `${c.subject}\n\n${c.body}` : c.subject)
