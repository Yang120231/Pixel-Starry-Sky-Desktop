// 项目工具的装配（docs/ui/project-tools.md）：任务、服务、Git 副本、Git 面板。本机和远端辅助进程用同一套接线
import type { EngineHost } from '@pixelsky/engine'
import type { SessionRecord } from '@pixelsky/protocol'
import type { WorkspaceRef, WorkspaceTarget } from '../../../shared/types/workspace'
import { samePath, type ToolsHost } from './common'
import { Copies } from './copies'
import { GitTools, type GitTrash } from './git'
import { Services } from './services'
import { Tasks } from './tasks'

export class ProjectTools {
  readonly tasks: Tasks
  readonly services: Services
  readonly copies: Copies
  readonly git: GitTools

  constructor(dir: string, host: ToolsHost, changed: () => void, opts: { trash?: GitTrash } = {}) {
    this.tasks = new Tasks(dir, host, changed)
    // 服务和副本互相引用：删除副本前先停它目录里的服务，启动服务前核对副本
    this.services = new Services(dir, host, changed, (id, path) => this.copies.verifyPath(id, path))
    this.copies = new Copies(dir, host, changed, path => this.services.stopPath(path))
    this.git = new GitTools(host, changed, { trash: opts.trash })
  }

  async init(): Promise<void> {
    await Promise.all([this.tasks.init(), this.copies.init()])
    await this.services.init()
  }

  shutdown(): Promise<void> {
    return this.services.shutdown()
  }

  /** 新会话绑定到副本：副本必须属于项目且仍是有效的 worktree */
  async copyPath(projectId: string, copyId: string): Promise<string> {
    const copy = this.copies.get(copyId)
    if (copy.projectId !== projectId) throw new Error('副本不属于项目')
    await this.copies.verify(copy)
    return copy.path
  }
}

/**
 * 项目工具看到的引擎：解析工作区、列 AI 计划和会话、在副本里新建会话。
 * `host` 是取值函数：本机的 EngineHost 在初始化引擎后才有。
 */
export function createToolsHost(opts: {
  host: () => EngineHost | null
  resolve: (ref: WorkspaceRef) => WorkspaceTarget
  record: (id: string) => SessionRecord | null | undefined
}): ToolsHost {
  const loaded = (): EngineHost => {
    const host = opts.host()
    if (!host) throw new Error('项目尚未加载')
    return host
  }
  return {
    resolve(ref) {
      const target = opts.resolve(ref)
      const projectId = ref.projectId ?? opts.record(ref.sessionId!)?.projectId
      if (!projectId) throw new Error('项目不存在')
      return { projectId, name: target.name, path: target.path }
    },
    plans(projectId) {
      const host = opts.host()
      if (!host) return []
      return host
        .sessions()
        .filter(s => s.record.projectId === projectId && !s.record.archivedAt)
        .flatMap(s => {
          const items = host
            .open(s.record.id)
            .items.filter(
              (item): item is Extract<import('@pixelsky/protocol').Item, { kind: 'todo' }> => item.kind === 'todo',
            )
          const item = items.at(-1)
          return item ? [{ sessionId: s.record.id, title: s.record.title, item }] : []
        })
    },
    sessions(path) {
      return (
        opts
          .host()
          ?.sessions()
          .filter(s => samePath(s.record.cwd, path))
          .map(s => ({ id: s.record.id, title: s.record.title, state: s.state })) ?? []
      )
    },
    create(projectId, cwd) {
      return loaded().createSession({ projectId }, cwd)
    },
    async withStopped(path, action) {
      return loaded().withWorkspaceStopped(path, action)
    },
  }
}
