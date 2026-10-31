// 输入框对应的工作区（docs/ui/workbench-ux-3.md §2.2、§2.6）：新任务起点看哪个项目的改动、@ 在哪个项目里找文件
import { isChatProject } from '@pixelsky/protocol'
import type { StatusBarController } from '@/features/engine'
import { draftWorkspace } from '@/features/machines/drafts'
import type { WorkspaceRef } from '../../../../shared/types/workspace'

/** 已开始的会话用会话（副本里的会话找的是副本）；新任务选了副本时用副本的会话，否则用选好的项目；没选项目时没有 */
export function composerWorkspace(
  sessionId: string | null | undefined,
  status: StatusBarController | undefined,
  draftKey: string | undefined,
): WorkspaceRef | null {
  if (sessionId) return { sessionId }
  const draft = draftKey ? draftWorkspace(draftKey) : null
  if (draft?.sessionId) return { sessionId: draft.sessionId }
  return status?.project ? { projectId: status.project.id } : null
}

/** 有文件夹的工作区：「对话」发第一条消息前还没有文件夹，@ 文件、Git 都不查（主进程解析不了 { projectId: 'chat' }） */
export function folderWorkspace(...args: Parameters<typeof composerWorkspace>): WorkspaceRef | null {
  const ref = composerWorkspace(...args)
  return isChatProject(ref?.projectId) ? null : ref
}
