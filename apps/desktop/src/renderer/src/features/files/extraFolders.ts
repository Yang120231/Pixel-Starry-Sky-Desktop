// 多文件夹项目（docs/ui/multi-root-projects.md §3.4）：界面显示时把「::N」换回文件夹名（按引擎状态里的项目找文件夹）
import type { ProjectFolder } from '@pixelsky/protocol'
import { getEngineState } from '@/features/engine/store'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { folderLabel, splitExtra } from './extraFolderPaths'

export { folderLabel, isAbsolutePath, relativeInFolders, splitExtra } from './extraFolderPaths'

/** 这个引用对应项目的第 index 个附加文件夹；找不到时 undefined */
export function extraFolder(ref: WorkspaceRef, index: number): ProjectFolder | undefined {
  const state = getEngineState()
  const projectId = ref.projectId ?? state.sessions.find(s => s.record.id === ref.sessionId)?.record.projectId
  return state.projects.find(p => p.id === projectId)?.folders?.[index - 1]
}

/** 给人看的路径：附加文件夹里的写成「文件夹名/相对路径」，主文件夹里的原样 */
export function displayPath(ref: WorkspaceRef, path: string): string {
  const { index, rest } = splitExtra(path)
  if (index === null) return path
  const folder = extraFolder(ref, index)
  return (folder ? folderLabel(folder) : `::${index}`) + (rest ? '/' + rest : '')
}
