// 提交历史的显示模型（docs/ui/git-panel.md §9.3）：引用标记、时间、列表里的行（含未拉取 / 未推送两条特殊行）。纯函数。
import { tr } from '@/i18n/core'
import type { GitCommit, GitRefLabel } from '../../../../../shared/types/project-tools'
import { spacerRow, type GraphRow } from './graph'

export type BadgeKind = 'current' | 'head' | 'branch' | 'both' | 'remote' | 'tag' | 'base'
export interface Badge {
  kind: BadgeKind
  name: string
}

const ORDER: BadgeKind[] = ['current', 'head', 'base', 'branch', 'both', 'remote', 'tag']

/** 同名的本地分支和远端分支（origin/x 和 x）合成一个「本地 & 远端」；基础分支单独标；当前分支排最前 */
export function refBadges(refs: readonly GitRefLabel[], base: string | null): Badge[] {
  const remotes = refs.filter(r => r.kind === 'remote')
  const merged = new Set<string>()
  const badges: Badge[] = []
  for (const r of refs) {
    if (r.kind === 'head') badges.push({ kind: 'head', name: 'HEAD' })
    else if (r.kind === 'tag') badges.push({ kind: 'tag', name: r.name })
    else if (r.kind === 'branch') {
      const twin = remotes.find(
        x => x.name.endsWith('/' + r.name) && !x.name.slice(0, -r.name.length - 1).includes('/'),
      )
      if (twin) merged.add(twin.name)
      const kind: BadgeKind = r.current ? 'current' : r.name === base ? 'base' : twin ? 'both' : 'branch'
      badges.push({ kind, name: r.name })
    }
  }
  for (const r of remotes)
    if (!merged.has(r.name)) badges.push({ kind: r.name === base ? 'base' : 'remote', name: r.name })
  return badges.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
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
  | { type: 'special'; kind: SpecialKind; count: number; graph: GraphRow | null }
  | { type: 'commit'; commit: GitCommit; graph: GraphRow | null; head: boolean }

/**
 * 列表里的行：提交按顺序；没有搜索时在 HEAD 上方插「未推送」、在上游最新提交上方插「未拉取」（参照 VS Code 的 outgoing / incoming）。
 * rows 是分支线（搜索时为 null）。
 */
export function historyEntries(
  commits: readonly GitCommit[],
  rows: readonly GraphRow[] | null,
  ctx: { head: string | null; upstream: string | null; ahead: number; behind: number },
): HistoryEntry[] {
  const out: HistoryEntry[] = []
  commits.forEach((commit, i) => {
    const graph = rows?.[i] ?? null
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
