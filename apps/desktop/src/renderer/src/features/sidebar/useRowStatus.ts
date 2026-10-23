import { useMemo } from 'react'
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
  return useMemo(
    () => statusOf({ card, running, unread, folderMissing, machine, prs, mentioned, display, sessionId }),
    [card, running, unread, folderMissing, machine, prs, mentioned, display, sessionId],
  )
}
