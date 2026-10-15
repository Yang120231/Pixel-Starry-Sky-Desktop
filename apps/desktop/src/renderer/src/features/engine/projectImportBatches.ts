import type { AddProjectsResult } from '@pixelsky/protocol'

/** 宿主一次最多接收 500 个路径；分批失败也返回明细，让剩下的项目继续添加。 */
export async function addProjectsInBatches(
  paths: readonly string[],
  add: (paths: string[]) => Promise<AddProjectsResult>,
): Promise<AddProjectsResult> {
  const result: AddProjectsResult = { added: [], existing: [], failed: [] }
  const seen = new Set<string>()
  for (let start = 0; start < paths.length; start += 500) {
    const batch = paths.slice(start, start + 500)
    try {
      const next = await add(batch)
      for (const kind of ['added', 'existing'] as const)
        for (const project of next[kind])
          if (!seen.has(project.id)) {
            seen.add(project.id)
            result[kind].push(project)
          }
      result.failed.push(...next.failed)
    } catch (e) {
      result.failed.push(...batch.map(path => ({ path, error: e instanceof Error ? e.message : String(e) })))
    }
  }
  return result
}
