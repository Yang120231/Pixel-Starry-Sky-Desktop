// 本机（或远端辅助进程所在机器）上的项目 / 会话 → 工作目录。别的机器的目标由 app 层的 machines.target 解析
import type { EngineHost } from '@pixelsky/engine'
import type { WorkspaceRef, WorkspaceTarget } from '../../../shared/types/workspace'

/** 桌面文件与编辑器只读取已有的目标，不启动或重建会话引擎。 */
export function resolveLocalWorkspace(host: EngineHost, ref: WorkspaceRef): WorkspaceTarget {
  if (ref.sessionId) {
    const record = host.record(ref.sessionId)
    if (!record) throw new Error('会话已不存在')
    const project = host.projects().find(p => p.id === record.projectId)
    const durableRef =
      project && project.path.toLowerCase() === record.cwd.toLowerCase() ? { projectId: project.id } : ref
    return { ref: durableRef, path: record.cwd, name: project?.name ?? record.cwd.split(/[\\/]/).pop() ?? record.title }
  }
  const project = host.projects().find(p => p.id === ref.projectId)
  if (!project) throw new Error('项目已不存在')
  return { ref, path: project.path, name: project.name }
}
