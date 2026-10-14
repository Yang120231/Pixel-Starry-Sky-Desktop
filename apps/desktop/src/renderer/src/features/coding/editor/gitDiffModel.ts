import type { GitArea } from '../../../../../shared/types/project-tools'
import { GIT_DIFF_PREFIX } from './codeTabsModel'

/** 中栏「Git 对比」标签的纯逻辑：id、区域标签、点文件的去向、文件换区后标签怎么跟 */
export type GitDiffArea = GitArea | 'commit'

export interface GitDiffKey {
  refKey: string
  area: GitDiffArea
  path: string
  /** 只有历史里的提交文件有 */
  from?: string | null
  to?: string | null
}

/** 同一个工作区、区域（、提交）、文件对应同一个 id，所以再点一次是激活已有标签 */
export const gitDiffId = (k: GitDiffKey): string =>
  `${GIT_DIFF_PREFIX}${k.refKey}:${k.area}:${k.from ?? ''}..${k.to ?? ''}:${k.path}`

/** 标签上的小标记：工作区的更改 / 暂存区 / 提交短哈希 */
export type GitDiffTag = { kind: 'work' } | { kind: 'staged' } | { kind: 'commit'; hash: string }

export function diffTag(area: GitDiffArea, to: string | null | undefined): GitDiffTag {
  if (area === 'commit') return { kind: 'commit', hash: (to ?? '').slice(0, 7) }
  return area === 'staged' ? { kind: 'staged' } : { kind: 'work' }
}

/**
 * 代码模式里工作区改动怎么打开（设置 › 外观，docs/ui/coding-mode.md §3.3.2）：
 * - file（样式 A，默认）：更改 / 未跟踪 / 冲突的文件打开成中栏的普通文件标签，切到「变更」对比 HEAD，能直接切回编辑；
 * - diff（样式 B）：一律开只读的「Git 对比」标签。
 * 暂存区、历史里的提交、删除的文件、不在工作区里的文件（local 为 null）两种样式都开「Git 对比」标签
 */
export type GitOpenStyle = 'file' | 'diff'
export const GIT_OPEN_KEY = 'pixelsky.coding.git-open'
export const parseGitOpenStyle = (value: unknown): GitOpenStyle => (value === 'diff' ? 'diff' : 'file')

export function gitOpenTarget(
  style: GitOpenStyle,
  area: GitDiffArea,
  file: { code: string; local: string | null },
): 'file' | 'diff' {
  if (style !== 'file') return 'diff'
  if (area !== 'unstaged' && area !== 'untracked' && area !== 'conflicted') return 'diff'
  return file.local && file.code !== 'D' ? 'file' : 'diff'
}

/** 点一个文件看差异：代码模式（中栏已注册打开方式）放中栏，否则在 Git 面板里就地显示 */
export const routeGitDiff = (centerOpener: boolean): 'center' | 'inline' => (centerOpener ? 'center' : 'inline')

/** 工具条上的动作：更改 / 未跟踪 / 冲突 → 暂存；更改 / 未跟踪 → 还原；暂存 → 取消暂存；提交里的文件只读 */
export function diffActions(area: GitDiffArea): { stage: boolean; unstage: boolean; discard: boolean } {
  return {
    stage: area === 'unstaged' || area === 'untracked' || area === 'conflicted',
    unstage: area === 'staged',
    discard: area === 'unstaged' || area === 'untracked',
  }
}

export type SyncPlan =
  | { kind: 'keep' }
  | { kind: 'refresh'; code: string }
  | { kind: 'move'; area: GitArea; code: string }
  | { kind: 'close' }

/**
 * 状态刷新后，工作区的对比标签怎么办（lookup 返回这个文件在某个区的状态字母，不在那个区是 null）：
 * - 文件还在原来的区：保留；状态字母变了就重新读差异
 * - 不在原来的区但在别的区（暂存 / 取消暂存后）：标签跟着换到新区（标签、按钮、左栏高亮一起变）
 * - 哪个区都没有了（还原、提交、文件没了）：关掉标签
 */
export function planSync(area: GitArea, code: string, lookup: (area: GitArea) => string | null): SyncPlan {
  const now = lookup(area)
  if (now !== null) return now === code ? { kind: 'keep' } : { kind: 'refresh', code: now }
  const order: GitArea[] =
    area === 'staged' ? ['unstaged', 'untracked', 'conflicted'] : ['staged', 'unstaged', 'untracked', 'conflicted']
  for (const to of order) {
    const found = to === area ? null : lookup(to)
    if (found !== null) return { kind: 'move', area: to, code: found }
  }
  return { kind: 'close' }
}
