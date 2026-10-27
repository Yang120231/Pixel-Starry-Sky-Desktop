import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { getEngineState } from '@/features/engine/store'
import { isDemo, projects } from '@/data'

/** 工作区属于哪个项目：会话的按它的记录找（终端按项目分组，文件树拖进终端也按它比） */
export function projectOf(ref: WorkspaceRef | null): string | null {
  if (!ref) return null
  if (ref.projectId) return ref.projectId
  if (isDemo) return projects.find(p => p.sessions.some(s => s.id === ref.sessionId))?.id ?? null
  const engine = getEngineState()
  return (
    engine.snapshots[ref.sessionId!]?.record.projectId ??
    engine.sessions.find(s => s.record.id === ref.sessionId)?.record.projectId ??
    null
  )
}
