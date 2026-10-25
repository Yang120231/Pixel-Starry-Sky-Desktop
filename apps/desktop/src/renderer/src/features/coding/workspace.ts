import { isLive } from '@/features/engine'
import { setCurrentProject } from '@/features/engine/store'
import { useProjectContext } from '@/features/panel/projectContext'
import { paneActions, usePaneState } from '@/features/panes/store'
import { focusedTab, isFileTab, isNewTab } from '@/features/panes/tree'
import { isDemo, projects as demoProjects } from '@/data'
import type { WorkspaceRef } from '../../../../shared/types/workspace'

export interface CodingWorkspace {
  ref: WorkspaceRef | null
  projectId: string | null
  name: string
  path: string
  key: string
}

/** 代码模式的当前项目：就是 useProjectContext()（焦点标签对应的工作区） */
export function useCodingWorkspace(): CodingWorkspace {
  const { ref, projectId, name, path, key } = useProjectContext()
  return { ref, projectId, name, path, key }
}

/** 窗格的焦点标签；文件标签或没有标签时为 null */
export function useCodingChatTab(): string | null {
  return usePaneState(s => {
    const tab = focusedTab(s.layout)
    return tab && !isFileTab(tab) ? tab : null
  })
}

/** 焦点标签是真实会话（不是 new:）时返回它 */
export function useCodingSessionId(): string | null {
  const tab = useCodingChatTab()
  return tab && !isNewTab(tab) ? tab : null
}

/** 和 tabHost.tsx、composerTarget.ts 同一条规则：isLive ? tab : `demo:${tab}` */
export const chatDraftKey = (tab: string): string => (isLive ? tab : `demo:${tab}`)

/**
 * 在这个项目下新开对话。演示模式下 paneActions.open(null, {project}) 会提前返回，
 * 新标签也会落到 projects[0]（editor/target.ts），所以演示模式下 projectId 不是 projects[0] 就返回 false，
 * 由调用方弹「即将推出」提示
 */
export function newChatInProject(projectId: string | null): boolean {
  if (isDemo) {
    if (projectId && projectId !== demoProjects[0]?.id) return false
    paneActions.open(null)
    return true
  }
  if (!projectId) {
    paneActions.open(null)
    return true
  }
  setCurrentProject(projectId)
  paneActions.open(null, { project: projectId })
  return true
}
