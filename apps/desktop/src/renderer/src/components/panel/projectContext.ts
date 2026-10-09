import { isDemo, projects as demoProjects } from '@/mock/data'
import { useActiveWorkspace } from '@/editor/target'
import { useEngineState } from '@/engine'
import type { WorkspaceRef } from '../../../../shared/types/workspace'

export function useProjectContext(): {
  projectId: string | null
  name: string
  path: string
  ref: WorkspaceRef | null
  demo: boolean
  key: string
} {
  const active = useActiveWorkspace()
  const projects = useEngineState(state => state.projects),
    sessions = useEngineState(state => state.sessions)
  const id =
    active.ref?.projectId ?? sessions.find(s => s.record.id === active.ref?.sessionId)?.record.projectId ?? null
  const project = isDemo
    ? (demoProjects.find(p => p.id === active.ref?.projectId || p.sessions.some(s => s.id === active.ref?.sessionId)) ??
      demoProjects[0])
    : projects.find(p => p.id === id)
  return {
    projectId: project?.id ?? id,
    name: project?.name ?? active.name,
    path: active.path,
    ref: active.ref,
    demo: isDemo,
    key: (project?.id ?? id ?? '') + ':' + active.path,
  }
}
