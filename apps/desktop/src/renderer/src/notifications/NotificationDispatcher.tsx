// 系统通知调度（docs/ui/notifications.md §3–§4）：监听所有机器的引擎事件，按偏好决定是否让主进程弹出。
// 窗口级挂载一次，不渲染任何内容；演示模式不工作。
import { useEffect } from 'react'
import { tr, translateMessage } from '../i18n/core'
import { getEngineState, isViewingSession } from '@/engine/store'
import { OPEN_SESSION_EVENT } from '@/engine/openRequests'
import { getNotificationPrefs } from '@/settings/notifications'
import { createDeliveryState, decide, notificationFor, type NotificationIntent } from './policy'

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function payload(
  intent: NotificationIntent,
  summary: boolean,
  count: number,
): { title: string; body: string; sessionId: string | null } {
  if (summary)
    return { title: tr('notifications.title'), body: tr('notifications.body.summary', { count }), sessionId: null }
  const record = getEngineState().sessions.find(s => s.record.id === intent.sessionId)?.record
  const title = clip(record?.title || tr('notifications.title'), 120)
  const detail = intent.detail ? clip(translateMessage(intent.detail).replace(/\s+/g, ' ').trim(), 120) : ''
  const body =
    intent.kind === 'completed'
      ? tr('notifications.body.completed')
      : intent.kind === 'failed'
        ? detail
          ? tr('notifications.body.failedWith', { error: detail })
          : tr('notifications.failed.title')
        : detail
          ? tr('notifications.body.waitingWith', { detail })
          : tr('notifications.waiting.title')
  return { title, body: clip(body, 300), sessionId: intent.sessionId }
}

export function NotificationDispatcher() {
  useEffect(() => {
    const bridge = window.pixelsky
    if (!bridge || bridge.demo) return
    const state = createDeliveryState()
    const offEvents = bridge.engine.onEvent(event => {
      const intent = notificationFor(event)
      if (!intent) return
      const prefs = getNotificationPrefs()
      const decision = decide(
        intent,
        { prefs, focused: document.hasFocus(), viewing: isViewingSession(intent.sessionId), now: Date.now() },
        state,
      )
      if (!decision.show) return
      const content = payload(intent, decision.summary, state.recent.length)
      void bridge.notifications
        .show({
          id: decision.summary ? `summary-${Date.now()}` : intent.dedupeKey,
          ...content,
          sound: prefs.sound,
          attention: intent.kind === 'waiting',
        })
        .catch(() => {})
    })
    // 点击通知：主进程已经把窗口带到前台，这里打开对应会话（会自动切换机器、切回工作台）
    const offClicks = bridge.notifications.onClick(({ sessionId }) => {
      if (sessionId) window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId } }))
    })
    return () => {
      offEvents()
      offClicks()
    }
  }, [])
  return null
}
