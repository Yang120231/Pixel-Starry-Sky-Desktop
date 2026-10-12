// 打开任务（侧栏固定任务、全局搜索里的任务）：右侧「任务」面板跟着焦点标签所在的项目走，
// 要看别的项目的任务，得先让焦点标签落到那个项目上。尽量不新开标签（以前每次都开一个新会话）：
// 1. 焦点标签就在这个项目 → 不动；2. 别的窗格 / 标签开着这个项目的 → 切过去；
// 3. 打开这个项目最近的会话；4. 项目一个会话都没有，才新开一个这个项目的新会话。
import { isDemo, projects as demoProjects } from '@/data'
import { getEngineState } from '@/features/engine'
import { setCurrentProject } from '@/features/engine/store'
import { projectOfTab } from '@/features/editor/target'
import { showWorkbench } from '@/features/layout/page'
import { getPaneState, paneActions } from '@/features/panes/store'
import { requestTask } from './taskNavigation'
import { taskTarget } from './taskTarget'

/** 项目里最近的、没归档的会话 */
function recentSession(projectId: string): string | null {
  if (isDemo) return demoProjects.find(p => p.id === projectId)?.sessions[0]?.id ?? null
  return (
    getEngineState()
      .sessions.filter(s => s.record.projectId === projectId && !s.record.archivedAt)
      .sort((a, b) => b.record.updatedAt - a.record.updatedAt)[0]?.record.id ?? null
  )
}

export function openTask(projectId: string, taskId: string): void {
  showWorkbench()
  const target = taskTarget(getPaneState().layout, projectOfTab, projectId, recentSession(projectId))
  if (target.kind === 'tab') paneActions.activate(target.leafId, target.tab)
  else if (target.kind === 'session') paneActions.open(target.id)
  else if (target.kind === 'new') {
    setCurrentProject(projectId)
    paneActions.open(null, { project: projectId })
  }
  requestTask(projectId, taskId)
}
