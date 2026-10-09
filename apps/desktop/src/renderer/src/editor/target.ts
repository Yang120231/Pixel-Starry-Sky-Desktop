import { useEngineState } from '@/engine'
import { usePaneState } from '@/panes/store'
import { focusedTab, isNewTab, parseFileTab } from '@/panes/tree'
import { useFiles } from '@/files/store'
import { isDemo, projects } from '@/mock/data'
import type { WorkspaceRef } from '../../../preload/workspace'
import { draftWorkspace } from '@/machines/drafts'

export function useActiveWorkspace(): { ref: WorkspaceRef | null; name: string; path: string; key: string } {
  const tab = usePaneState(s => focusedTab(s.layout))
  const state = useEngineState(s => s)
  const files = useFiles(),
    file = files.tabs.find(t => t.id === tab),
    parsed = tab ? parseFileTab(tab) : null
  if (parsed) {
    const ref = file?.ref ?? parsed.ref
    const project = state.projects.find(p => p.id === ref.projectId)
    const demo = isDemo
      ? projects.find(p => p.id === ref.projectId || p.sessions.some(s => s.id === ref.sessionId))
      : null
    return {
      ref,
      name: file?.project || project?.name || demo?.name || '',
      path: file?.root || project?.path || demo?.name || '',
      key: tab!,
    }
  }
  if (isDemo) {
    const project = projects.find(p => p.sessions.some(s => s.id === tab)) ?? projects[0]
    const ref = project ? { projectId: project.id } : null
    return { ref, name: project?.name ?? '', path: project?.name ?? '', key: project?.id ?? '' }
  }
  if (tab && !isNewTab(tab)) {
    const record = state.snapshots[tab]?.record ?? state.sessions.find(s => s.record.id === tab)?.record
    return {
      ref: record ? { sessionId: tab } : null,
      name: (() => {
        const p = state.projects.find(p => p.id === record?.projectId)
        return p && record && p.path.toLowerCase() !== record.cwd.toLowerCase()
          ? p.name + ' / ' + record.cwd.split(/[\\/]/).pop()
          : (p?.name ?? record?.title ?? '')
      })(),
      path: record?.cwd ?? '',
      key: tab,
    }
  }
  const project = state.projects.find(p => p.id === state.currentProjectId)
  const draft = tab ? draftWorkspace(tab) : null
  if (draft)
    return {
      ref: draft.sessionId ? { sessionId: draft.sessionId } : { projectId: draft.projectId },
      name: draft.name,
      path: draft.path,
      key: tab!,
    }
  return {
    ref: project ? { projectId: project.id } : null,
    name: project?.name ?? '',
    path: project?.path ?? '',
    key: project?.id ?? '',
  }
}
export const refKey = (ref: WorkspaceRef): string => (ref.sessionId ? `s:${ref.sessionId}` : `p:${ref.projectId}`)
