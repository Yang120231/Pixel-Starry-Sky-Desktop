import { useMemo } from 'react'
import { useEngineState } from '@/features/engine/store'
import { formatDuration } from '@/features/session/live/agentTrace'
import { useSince } from '@/features/session/live/stepClock'
import { activityKey, activityText, type Activity } from './activityModel'

/** AI 在这个会话里正在做什么；运行中每秒刷新一次（用时），没在运行返回 null。只读快照，不打开会话 */
export function useCodingActivity(sessionId: string | null): Activity | null {
  const snap = useEngineState(s => (sessionId ? (s.snapshots[sessionId] ?? null) : null))
  const items = snap?.items
  const running = !!snap && snap.state !== 'idle'
  // 等你批准 / 回答时不算「正在做」
  const live = !!snap && (snap.state === 'running' || snap.state === 'starting')
  const key = useMemo(() => (items ? activityKey(items, running, live) : null), [items, running, live])
  const since = useSince(key, key !== null)
  return useMemo(
    () => (items ? activityText(items, running, since, live, formatDuration) : null),
    [items, running, since, live],
  )
}
