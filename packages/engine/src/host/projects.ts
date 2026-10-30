// 项目列表：添加、改名、移除（不动磁盘上的文件夹）
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import {
  CHAT_PROJECT_ID,
  normalizeProjectName,
  type AddProjectsResult,
  type ProjectFolder,
  type ProjectRecord,
} from '@pixelsky/protocol'
import type { HostContext } from './context'

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export class HostProjects {
  private list: ProjectRecord[]

  constructor(private readonly ctx: HostContext) {
    this.list = ctx.store.loadProjects()
  }

  /** 找得到「对话」这个内置项目（不在 projects() 里）：路径是各对话文件夹的上一级 */
  find(id: string): ProjectRecord | undefined {
    if (id === CHAT_PROJECT_ID) return { id, name: '对话', path: this.chatRoot(), addedAt: 0 }
    return this.list.find(p => p.id === id)
  }

  /** 不用项目的对话放在这里，每个对话一个子文件夹 */
  chatRoot(): string {
    return join(this.ctx.opts.dataDir, 'chats')
  }

  projects(): ProjectRecord[] {
    return [...this.list]
  }

  addProject(path: string): ProjectRecord {
    const result = this.addProjects([path])
    if (result.failed[0]) throw new Error(result.failed[0].error)
    return result.added[0] ?? result.existing[0]
  }

  /** 一次加多个（按给的顺序排到最后）：同一个目录只加一次，加不上的记下原因；只写一次文件、只推一次 */
  addProjects(paths: readonly string[]): AddProjectsResult {
    const guard = this.ctx.m.guard
    const result: AddProjectsResult = { added: [], existing: [], failed: [] }
    let list = this.list
    const now = Date.now()
    for (const path of paths) {
      const abs = resolve(path)
      if (!isDir(abs)) {
        result.failed.push({ path: abs, error: `目录不存在：${abs}` })
        continue
      }
      const same = list.find(p => guard.workspaceKey(p.path) === guard.workspaceKey(abs))
      if (same) {
        if (!result.added.includes(same) && !result.existing.includes(same)) result.existing.push(same)
        continue
      }
      const project: ProjectRecord = { id: randomUUID(), name: basename(abs) || abs, path: abs, addedAt: now }
      list = [...list, project]
      result.added.push(project)
    }
    if (result.added.length) {
      this.list = list
      this.ctx.store.saveProjects(this.list)
      this.ctx.opts.emit({ kind: 'projects', projects: this.projects() })
    }
    return result
  }

  renameProject(id: string, name: unknown): ProjectRecord {
    const value = normalizeProjectName(name)
    const project = this.list.find(p => p.id === id)
    if (!project) throw new Error('项目不存在')
    const renamed = { ...project, name: value }
    this.list = this.list.map(p => (p.id === id ? renamed : p))
    this.ctx.store.saveProjects(this.list)
    this.ctx.opts.emit({ kind: 'projects', projects: this.projects() })
    return renamed
  }

  /**
   * 改项目的附加文件夹（docs/ui/multi-root-projects.md §3.2）：整组替换，按给的顺序。
   * 每个都要是已有的文件夹，不能和主文件夹相同，重复的只留一个；最多 20 个。已经开始的对话不受影响
   */
  setProjectFolders(id: string, folders: unknown): ProjectRecord {
    const project = this.list.find(p => p.id === id)
    if (!project) throw new Error('项目不存在')
    if (!Array.isArray(folders) || folders.length > 20) throw new Error('项目文件夹不对')
    const guard = this.ctx.m.guard
    const seen = new Set([guard.workspaceKey(project.path)])
    const next: ProjectFolder[] = []
    for (const raw of folders as unknown[]) {
      const item = typeof raw === 'string' ? { path: raw } : (raw as { path?: unknown; name?: unknown } | null)
      if (!item || typeof item.path !== 'string' || !item.path.trim()) throw new Error('项目文件夹不对')
      const abs = resolve(item.path)
      if (!isDir(abs)) throw new Error(`目录不存在：${abs}`)
      const key = guard.workspaceKey(abs)
      if (seen.has(key)) continue
      seen.add(key)
      const name = typeof item.name === 'string' && item.name.trim() ? normalizeProjectName(item.name) : undefined
      next.push(name ? { path: abs, name } : { path: abs })
    }
    const { folders: _old, ...rest } = project
    const updated: ProjectRecord = next.length ? { ...rest, folders: next } : rest
    this.list = this.list.map(p => (p.id === id ? updated : p))
    this.ctx.store.saveProjects(this.list)
    this.ctx.opts.emit({ kind: 'projects', projects: this.projects() })
    return updated
  }

  removeProject(id: string): void {
    this.list = this.list.filter(p => p.id !== id)
    this.ctx.store.saveProjects(this.list)
    this.ctx.opts.emit({ kind: 'projects', projects: this.projects() })
  }
}
