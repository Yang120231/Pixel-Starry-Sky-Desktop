// 团队回复的系统通知（docs/ui/feedback.md §2.6）：窗口级挂载一次，不渲染任何内容；演示模式不工作。
// 每条回复只提醒一次由主进程保证（change.fresh 里每条只出现一次）；这里按通知设置（勿扰、仅在后台时通知、声音）决定弹不弹。
// 处理完（弹了或决定不弹）回一声 ack，主进程才记成已提醒；挂载时先取回窗口打开前推过来、没处理的（审查报告 2026-10-14）。
import { useEffect } from 'react'
import type { FeedbackSummary } from '../../../../shared/types/feedback'
import { tr } from '../../i18n/core'
import { getNotificationPrefs } from '@/features/settings/notifications'
import { freshNotice, shouldNotify } from './logic'
import { isDemoFeedback, onFeedbackChange } from './store'

export function FeedbackNotifier() {
  useEffect(() => {
    const bridge = window.pixelsky
    if (!bridge || bridge.demo || isDemoFeedback()) return
    // 刚挂载时取回的和紧接着推过来的可能是同一批：同一条回复（同一版本）只处理一次
    const seen = new Set<string>()
    const handle = (all: FeedbackSummary[]): void => {
      const fresh = all.filter(t => !seen.has(`${t.id}:${t.updatedAt}`))
      for (const t of fresh) seen.add(`${t.id}:${t.updatedAt}`)
      const notice = freshNotice(fresh)
      if (!notice) return
      const prefs = getNotificationPrefs()
      if (shouldNotify(prefs, document.hasFocus(), Date.now()))
        void bridge.notifications
          .show({
            id: notice.id,
            title:
              notice.count > 1 ? tr('feedback.notify.titleMany', { p0: notice.count }) : tr('feedback.notify.title'),
            body: notice.body,
            sessionId: null,
            sound: prefs.sound,
            attention: false,
          })
          .catch(() => {})
      void bridge.feedback.ack(fresh.map(t => t.id)).catch(() => {})
    }
    const off = onFeedbackChange(change => handle(change.fresh))
    void bridge.feedback
      .pending()
      .then(handle)
      .catch(() => {})
    return off
  }, [])
  return null
}
