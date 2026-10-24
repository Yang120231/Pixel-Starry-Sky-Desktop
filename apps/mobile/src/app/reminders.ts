// App 在后台时的本机提醒（M4b）：盯着所有配对电脑推来的会话列表，有任务等你处理 / 完成 / 出错就弹通知；
// 切到后台时启动前台服务保持连接，回到前台时停掉。网页版里 platform 都是空操作。
import { useEffect, useRef } from 'react'
import type { SessionSummary } from '@pixelsky/protocol'
import { connections } from '@/connection'
import { reminders } from '@/data/notify'
import { inApp, keepAlive, notify, onAppState, onNotificationTap, prepareNotifications } from '@/platform'
import { L } from '@/i18n'

export function useReminders(open: (deviceId: string, sessionId: string) => void): void {
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (!inApp) return
    let active = true
    if (connections.list().some(p => p.status === 'paired')) prepareNotifications()
    const last = new Map<string, SessionSummary[]>()
    const onEvent = (deviceId: string, event: unknown) => {
      const e = event as { kind?: string; sessions?: SessionSummary[] }
      if (e.kind !== 'sessions' || !e.sessions) return
      const found = reminders(last.get(deviceId) ?? null, e.sessions)
      last.set(deviceId, e.sessions)
      if (active) return
      const desktop = connections.list().find(p => p.deviceId === deviceId)?.desktopName ?? ''
      const many = connections.list().length > 1
      for (const r of found)
        void notify(r.title, many && desktop ? L(`${r.body}（${desktop}）`, `${r.body} (${desktop})`) : r.body, {
          deviceId,
          sessionId: r.sessionId,
        })
    }
    connections.eventListeners.add(onEvent)
    // 刚配对好的电脑：从这时起要通知权限
    const offList = connections.subscribe(() => {
      if (connections.list().some(p => p.status === 'paired')) prepareNotifications()
    })
    const offState = onAppState(isActive => {
      active = isActive
      const paired = connections.list().filter(p => p.status === 'paired').length
      void keepAlive(!isActive && paired > 0, paired)
    })
    const offTap = onNotificationTap(extra => {
      if (extra.deviceId && extra.sessionId) openRef.current(extra.deviceId, extra.sessionId)
    })
    return () => {
      connections.eventListeners.delete(onEvent)
      offList()
      offState()
      offTap()
    }
  }, [])
}
