// 一次加了几个项目后的那句提示（docs/ui/multi-root-projects.md §2.2）：纯函数，ProjectImport 和测试共用
import type { AddProjectsResult } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import type { ProjectImportCandidate } from '../../../../shared/types/project-import'

const folderName = (path: string): string =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path

/** 只加了一个新项目时不提示（和原来一样，直接切过去）；其余情况说清楚加了几个、几个本来就在、几个加不上 */
export function addedSummary(result: AddProjectsResult): string | null {
  const { added, existing, failed } = result
  if (added.length <= 1 && !existing.length && !failed.length) return null
  const parts: string[] = []
  if (added.length) parts.push(tr('projectImport.added', { n: added.length }))
  if (existing.length)
    parts.push(
      !added.length && !failed.length && existing.length === 1
        ? tr('projectImport.existingOne', { name: existing[0].name })
        : tr('projectImport.existing', { n: existing.length }),
    )
  if (failed.length) {
    const names = failed.slice(0, 3).map(f => folderName(f.path))
    if (failed.length > 3) names.push('…')
    parts.push(tr('projectImport.failed', { n: failed.length, names: names.join(tr('projectImport.nameSeparator')) }))
  }
  return parts.join(tr('projectImport.separator'))
}

/** 打开导入列表时默认勾上的：像项目、还没加的 */
export const defaultPicked = (candidates: readonly { path: string; project: boolean; added: boolean }[]): string[] =>
  candidates.filter(c => c.project && !c.added).map(c => c.path)

/** 候选路径已在主进程规范化；保留旧项顺序与用户勾选，重复来源合并。 */
export function mergeImportCandidates(
  current: readonly ProjectImportCandidate[],
  incoming: readonly ProjectImportCandidate[],
): ProjectImportCandidate[] {
  const merged = new Map(current.map(c => [c.path, c]))
  for (const candidate of incoming) {
    const old = merged.get(candidate.path)
    merged.set(candidate.path, {
      ...candidate,
      project: candidate.project || old?.project === true,
      sources: [...new Set([...(old?.sources ?? []), ...candidate.sources])],
    })
  }
  return [...merged.values()]
}
