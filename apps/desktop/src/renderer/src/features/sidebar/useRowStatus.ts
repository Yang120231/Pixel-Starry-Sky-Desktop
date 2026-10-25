import { useMemo } from 'react'
import type { QueuedMessage } from '@pixelsky/protocol'
import { useEngineState } from '@/features/engine'
import type { SessionCard } from '@/features/board/sessionLanes'
import { machineOf, useMachines } from '@/features/machines/store'
import { statusOf, type SessionStatus } from './sessionStatusModel'
import { useSessionStatus } from './useSessionStatus'
import { usePrDisplay } from './prDisplay'

/** 一行对话的状态：看板卡片 + 机器 + 主进程算的文件夹 / PR 合起来，按 statusOf 的先后挑一个放左边格子；PR 图标按 prDisplay 筛 */
export function useRowStatus(
  sessionId: string,
  input: { card?: SessionCard | null; running: boolean; unread: boolean },
): SessionStatus {
  const extra = useSessionStatus()
  const machines = useMachines().machines
  const id = machineOf(sessionId)
  const machine = id === 'local' ? null : (machines.find(m => m.id === id) ?? null)
  const { card, running, unread } = input
  const folderMissing = !!extra.missingFolders[sessionId]
  const prs = extra.prs[sessionId]
  const mentioned = extra.mentioned[sessionId]?.length ?? 0
  const display = usePrDisplay()
  const limitAt = useEngineState(s => limitAtOf(s, sessionId))
  return useMemo(
    () => statusOf({ card, running, unread, folderMissing, machine, prs, mentioned, display, sessionId, limitAt }),
    [card, running, unread, folderMissing, machine, prs, mentioned, display, sessionId, limitAt],
  )
}

/**
 * 这个对话在等限流 / 额度恢复后自动继续的时间点（没有为 null）：会话列表的队列概况里有（QueueSummary.limitAt，主进程算好）；
 * 打开过的会话也看自己的快照（演示模式只有快照）
 */
function limitAtOf(
  s: {
    sessions: { record: { id: string }; queue?: { limitAt?: number } }[]
    snapshots: Record<string, { queue: QueuedMessage[]; queuePaused: boolean } | undefined>
  },
  sessionId: string,
): number | null {
  const listed = s.sessions.find(x => x.record.id === sessionId)?.queue?.limitAt
  if (listed !== undefined) return listed
  const snap = s.snapshots[sessionId]
  if (!snap || snap.queuePaused) return null
  const q = snap.queue.find(x => x.reconnect?.limited && x.status === 'queued')
  return q && (q.limit?.tries.length ?? 0) < (q.reconnect?.max ?? 3) ? q.reconnect!.at : null
}
