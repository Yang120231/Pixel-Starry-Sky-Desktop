import { useMemo } from 'react'
import { useSession } from '@/features/engine'
import { useCodingWorkspace } from '../workspace'
import { latestTurnChanges, type TurnChanges } from './turnChangesModel'

/** 本机 Windows 上路径不分大小写（照 files/store.ts 的判断） */
const caseInsensitive = typeof window !== 'undefined' && window.pixelsky?.platform === 'win32'

/** 这个会话最近一轮的文件改动；没有会话或没有改动时 null。结果按 items 引用缓存 */
export function useTurnChanges(sessionId: string | null): TurnChanges | null {
  const snapshot = useSession(sessionId)
  const root = useCodingWorkspace().path
  const items = snapshot?.items
  const running = !!snapshot && (snapshot.state === 'running' || snapshot.turnId !== null)
  return useMemo(
    () => (items ? latestTurnChanges(items, running, root, caseInsensitive) : null),
    [items, running, root],
  )
}
