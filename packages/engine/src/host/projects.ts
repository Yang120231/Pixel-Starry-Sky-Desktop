// 项目列表：添加、改名、移除（不动磁盘上的文件夹）
import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { normalizeProjectName, type ProjectRecord } from '@pixelsky/protocol'
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
    const abs = resolve(path)
    if (!isDir(abs)) throw new Error(`目录不存在：${abs}`)
    const guard = this.ctx.m.guard
    const same = this.list.find(p => guard.workspaceKey(p.path) === guard.workspaceKey(abs))
    if (same) return same
    const project: ProjectRecord = { id: randomUUID(), name: basename(abs) || abs, path: abs, addedAt: Date.now() }
    this.list = [...this.list, project]
    this.ctx.store.saveProjects(this.list)
    this.ctx.opts.emit({ kind: 'projects', projects: this.projects() })
    return project
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
