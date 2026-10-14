// 项目 / 会话 → 工作目录：远端机器的由 machines.target 解析，本机的交给 core（docs/restructure.md §8.3 P6）
import type { WorkspaceRef, WorkspaceTarget } from '../../shared/types/workspace'
import type { AppContext } from '../app/context'
import { createToolsHost } from '../core/project-tools/tools'
import type { ToolsHost } from '../core/project-tools/common'
import { resolveLocalWorkspace } from '../core/workspace/resolve'
import { machineOf } from '../machines/identity'
import type { TerminalTarget } from '../terminal/manager'

/** 桌面文件、编辑器、扩展、项目工具共用的工作区解析 */
export function resolveWorkspace(ctx: AppContext, ref: WorkspaceRef): WorkspaceTarget {
  if (machineOf(ref.projectId ?? ref.sessionId) !== 'local') {
    const target = ctx.machines?.target(ref)
    if (target) return target
    throw new Error('SSH_NOT_CONNECTED')
  }
  if (!ctx.engine) throw new Error('项目尚未加载')
  return resolveLocalWorkspace(ctx.engine, ref)
}

/** Project tools only create sessions in worktrees already validated by their manager. */
export function workspaceToolsHost(ctx: AppContext): ToolsHost {
  return createToolsHost({
    host: () => ctx.engine,
    resolve: ref => resolveWorkspace(ctx, ref),
    record: id => (machineOf(id) === 'local' ? ctx.engine?.record(id) : ctx.machines?.record(id)),
  })
}

/** 本机终端的工作目录：会话用会话目录，名称用项目名 */
export function resolveTerminalTarget(ctx: AppContext, ref: WorkspaceRef): TerminalTarget {
  const host = ctx.engine
  if (!host) throw new Error('项目尚未加载')
  // 在多文件夹项目的附加文件夹里开终端（docs/ui/multi-root-projects.md §3.4）
  if (ref.folder) {
    const target = resolveLocalWorkspace(host, ref)
    const projectId = ref.projectId ?? host.record(ref.sessionId!)?.projectId
    const project = host.projects().find(item => item.id === projectId)
    if (!project) throw new Error('项目已不存在')
    return { projectId: project.id, projectName: project.name, cwd: target.path }
  }
  if ('projectId' in ref) {
    const project = host.projects().find(item => item.id === ref.projectId)
    if (!project) throw new Error('项目已不存在')
    return { projectId: project.id, projectName: project.name, cwd: project.path }
  }
  const record = host.record(ref.sessionId)
  if (!record) throw new Error('会话已不存在')
  const project = host.projects().find(item => item.id === record.projectId)
  if (!project) throw new Error('项目已不存在')
  return { projectId: project.id, projectName: project.name, cwd: record.cwd }
}
