// 项目列表：添加、改名、移除（不动磁盘上的文件夹）
import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { normalizeProjectName, type AddProjectsResult, type ProjectRecord } from '@pixelsky/protocol'
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

  find(id: string): ProjectRecord | undefined {
    return this.list.find(p => p.id === id)
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

  removeProject(id: string): void {
    this.list = this.list.filter(p => p.id !== id)
    this.ctx.store.saveProjects(this.list)
    this.ctx.opts.emit({ kind: 'projects', projects: this.projects() })
  }
}
