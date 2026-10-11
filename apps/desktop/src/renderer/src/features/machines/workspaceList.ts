// 工作区选择的列表（docs/ui/machines-workspaces.md §8，issue #11）：按机器缓存，打开时先显示上次读到的，
// 在后台刷新后替换；同一时间同一组项目只读一次。应用启动后空闲时预读一次，第一次打开也不用等。
import type { WorkspaceChoice } from '../../../../shared/types/machines'

interface Project {
  id: string
  name: string
  path: string
}

const cache = new Map<string, WorkspaceChoice[]>()
const inflight = new Map<string, Promise<WorkspaceChoice[]>>()

const bare = (p: Project): WorkspaceChoice => ({
  projectId: p.id,
  name: p.name,
  path: p.path,
  copyId: null,
  branch: null,
  error: null,
})

/** 上次读到的列表，按现在的项目顺序；新加的项目还没读到时先只列项目本身；从没读过时为 null */
export function cachedWorkspaces(machine: string, projects: Project[]): WorkspaceChoice[] | null {
  const rows = cache.get(machine)
  if (!rows) return null
  return projects.flatMap(p => {
    const own = rows.filter(r => r.projectId === p.id)
    return own.length ? own : [bare(p)]
  })
}

/** 读一遍并更新缓存；读不到的项目给一行带错误的 */
export function loadWorkspaces(
  machine: string,
  projects: Project[],
  describe: (error: unknown) => string,
): Promise<WorkspaceChoice[]> {
  const key = machine + '\n' + projects.map(p => p.id).join('\n')
  const running = inflight.get(key)
  if (running) return running
  const task = Promise.all(
    projects.map(p => window.pixelsky!.machines.workspaces(p.id).catch(e => [{ ...bare(p), error: describe(e) }])),
  )
    .then(rows => {
      const flat = rows.flat()
      cache.set(machine, flat)
      return flat
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

/** 测试用 */
export function clearWorkspaceCache(): void {
  cache.clear()
  inflight.clear()
}
