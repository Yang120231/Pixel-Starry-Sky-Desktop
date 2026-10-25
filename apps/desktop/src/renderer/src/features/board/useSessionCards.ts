// 看板和底部胶囊共用的会话分类（docs/ui/task-board.md §2.1）：同一份数据、同一个函数，数字始终一致
import { useMemo } from 'react'
import { isLive, useEngineState, useSidebarData } from '@/features/engine'
import { useSessionDigests } from '@/features/engine/sessionDigest'
import { machineOf, useMachines } from '@/features/machines/store'
import { demo } from '@/data/demo'
import { useInbox } from '@/features/panel/inbox/useInbox'
import { demoSessionCards, sessionCards, type SessionCard } from './sessionLanes'

export function useSessionCards(): SessionCard[] {
  const inbox = useInbox()
  const sessions = useEngineState(s => s.sessions)
  // 只看最新待办：别的会话在输出时不跟着重算（docs/perf-audit-2026-10-18.md B3）
  const snapshots = useSessionDigests()
  const projects = useEngineState(s => s.projects)
  const unread = useEngineState(s => s.unread)
  const machine = useMachines().currentId
  const sidebar = useSidebarData()
  return useMemo(() => {
    if (!isLive)
      return demoSessionCards(
        [
          ...sidebar.projects.flatMap(p => p.sessions.map(s => ({ ...s, projectId: p.id, project: p.name }))),
          ...sidebar.pinned.map(s => ({ ...s, projectId: s.projectId ?? '', project: s.project ?? '' })),
        ],
        inbox,
        undefined,
        demo().scheduledSessions,
      )
    return sessionCards({
      sessions: sessions.filter(s => machineOf(s.record.id) === machine),
      snapshots,
      projectNames: Object.fromEntries(projects.map(p => [p.id, p.name])),
      unread,
      inbox,
    })
  }, [inbox, sessions, snapshots, projects, unread, machine, sidebar])
}
