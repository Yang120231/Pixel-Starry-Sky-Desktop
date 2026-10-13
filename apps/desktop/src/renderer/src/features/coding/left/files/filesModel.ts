// 左栏「文件」和「搜索」的纯逻辑：AI 小节排序、状态换算、搜索结果过滤和分组
import type { GitStatus } from '../../../../../../shared/types/project-tools'
import type { FileHit } from '@/features/search/fileSearch'
import type { TurnFile } from '../../ai/turnChangesModel'

/** 「AI 这一轮改的」排序：新增在前，其余按路径 */
export function sortTurnFiles<T extends Pick<TurnFile, 'path' | 'kind'>>(files: readonly T[]): T[] {
  const rank = (f: T): number => (f.kind === 'add' ? 0 : 1)
  return [...files].sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** 文件改动类型对应的文字颜色（Tailwind 类，映射自 tokens） */
export function kindTone(kind: TurnFile['kind']): string {
  return kind === 'add' ? 'text-success' : kind === 'delete' ? 'text-danger' : 'text-warn'
}

/** 演示模式的 Git 状态换算成树用的「路径到状态字母」。冲突 ! > 删除 D > 新增 A > 未跟踪 ? > 修改 M */
export function demoStatuses(
  status: Pick<GitStatus, 'staged' | 'unstaged' | 'untracked' | 'conflicted'>,
): Record<string, string> {
  const priority = ['M', '?', 'A', 'D', '!']
  const out: Record<string, string> = {}
  const put = (path: string, letter: string): void => {
    const old = out[path]
    if (!old || priority.indexOf(letter) > priority.indexOf(old)) out[path] = letter
  }
  const letterOf = (code: string): string => (code === 'A' ? 'A' : code === 'D' ? 'D' : code === '?' ? '?' : 'M')
  for (const f of [...status.staged, ...status.unstaged, ...status.untracked]) put(f.local ?? f.path, letterOf(f.code))
  for (const f of status.conflicted) put(f.local ?? f.path, '!')
  return out
}

/** 这个目录下面有没有改动 */
export function dirHasChanges(statuses: Record<string, string>, dir: string): boolean {
  const prefix = dir.replace(/\/$/, '') + '/'
  return Object.keys(statuses).some(p => p.startsWith(prefix))
}

export type SearchScope = 'name' | 'content'

/** 文件名模式只留 line 为 null 的，内容模式只留有行号的 */
export function filterHits(hits: readonly FileHit[], scope: SearchScope): FileHit[] {
  return hits.filter(h => (scope === 'name' ? h.line === null : h.line !== null))
}

export interface HitGroup {
  path: string
  name: string
  dir: string
  hits: FileHit[]
}

/** 按文件分组，保持第一次出现的顺序 */
export function groupHits(hits: readonly FileHit[]): HitGroup[] {
  const groups = new Map<string, HitGroup>()
  for (const hit of hits) {
    let g = groups.get(hit.path)
    if (!g) {
      const i = hit.path.lastIndexOf('/')
      g = { path: hit.path, name: hit.path.slice(i + 1), dir: i < 0 ? '' : hit.path.slice(0, i), hits: [] }
      groups.set(hit.path, g)
    }
    g.hits.push(hit)
  }
  return [...groups.values()]
}
