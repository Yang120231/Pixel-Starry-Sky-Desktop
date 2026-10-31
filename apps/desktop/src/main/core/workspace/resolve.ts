// 本机（或远端辅助进程所在机器）上的项目 / 会话 → 工作目录。别的机器的目标由 app 层的 machines.target 解析
import { basename } from 'node:path'
import type { EngineHost } from '@pixelsky/engine'
import { isChatProject, type ProjectFolder } from '@pixelsky/protocol'
import type { WorkspaceRef, WorkspaceTarget } from '../../../shared/types/workspace'

/** 附加文件夹 → 目标里的 folders（显示名缺省用文件夹名）；没有时不写（docs/ui/multi-root-projects.md §3.4） */
const foldersOf = (folders: readonly ProjectFolder[] | undefined): Pick<WorkspaceTarget, 'folders'> =>
  folders?.length ? { folders: folders.map(f => ({ path: f.path, name: f.name || basename(f.path) || f.path })) } : {}

/** 桌面文件与编辑器只读取已有的目标，不启动或重建会话引擎。chatName：「对话」的显示名（core 读不到界面语言，由 app 层传） */
export function resolveLocalWorkspace(host: EngineHost, ref: WorkspaceRef, chatName = '对话'): WorkspaceTarget {
  // 指名了附加文件夹（Git 面板切到别的仓库）：工作区就是那个文件夹，它自己没有附加文件夹
  if (ref.folder) {
    const { folder, ...base } = ref
    const whole = resolveLocalWorkspace(host, base as WorkspaceRef, chatName)
    const picked = whole.folders?.[folder - 1]
    if (!picked) throw new Error('项目里没有这个文件夹')
    return { ref: { ...whole.ref, folder }, path: picked.path, name: `${whole.name} · ${picked.name}` }
  }
  if (ref.sessionId) {
    const record = host.record(ref.sessionId)
    if (!record) throw new Error('会话已不存在')
    const project = host.projects().find(p => p.id === record.projectId)
    const durableRef =
      project && project.path.toLowerCase() === record.cwd.toLowerCase() ? { projectId: project.id } : ref
    // 按项目看文件时跟着项目现在的附加文件夹；不在项目主目录的会话（副本）用它创建时抄下的
    const folders =
      durableRef === ref ? foldersOf(record.extraDirs?.map(path => ({ path }))) : foldersOf(project?.folders)
    return {
      ref: durableRef,
      path: record.cwd,
      name:
        project?.name ??
        (isChatProject(record.projectId) ? chatName : (record.cwd.split(/[\\/]/).pop() ?? record.title)),
      ...folders,
    }
  }
  const project = host.projects().find(p => p.id === ref.projectId)
  if (!project) throw new Error('项目已不存在')
  return { ref, path: project.path, name: project.name, ...foldersOf(project.folders) }
}
