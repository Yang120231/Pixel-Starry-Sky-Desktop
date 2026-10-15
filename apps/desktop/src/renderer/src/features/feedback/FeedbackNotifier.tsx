// 团队回复的提醒（docs/ui/feedback.md §2.6、feedback-v2.md §4）：窗口级挂载一次；演示模式不工作。
// 窗口在前台：右下角应用内提示（FeedbackToast）；不在前台：系统通知；勿扰时都不提醒（见 logic.noticeChannel）。
// 每条回复只提醒一次由主进程保证（change.fresh 里每条只出现一次）。
// 处理完（提醒了或决定不提醒）回一声 ack，主进程才记成已提醒；挂载时先取回窗口打开前推过来、没处理的（审查报告 2026-10-14）。
import { useEffect } from 'react'
import type { FeedbackSummary } from '../../../../shared/types/feedback'
import { tr } from '../../i18n/core'
import { getNotificationPrefs } from '@/features/settings/notifications'
import { useSettings } from '@/features/settings/SettingsProvider'
import { FeedbackToast, showFeedbackToast, type FeedbackToastData } from './FeedbackToast'
import { requestFeedback } from './focus'
import { freshNotice, noticeChannel } from './logic'
import { isDemoFeedback, onFeedbackChange } from './store'

export function FeedbackNotifier() {
  const settings = useSettings()
  const openFeedback = (threadId: string): void => {
    requestFeedback({ threadId })
    settings.openSettings('feedback')
  }

  // 开发 / 截图用：派发 pixelsky:feedback-toast（detail 是 FeedbackToastData）直接弹一张提示，演示模式也能看
  useEffect(() => {
    const show = (e: Event): void => showFeedbackToast((e as CustomEvent<FeedbackToastData>).detail)
    window.addEventListener('pixelsky:feedback-toast', show)
    return () => window.removeEventListener('pixelsky:feedback-toast', show)
  }, [])

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
      const channel = noticeChannel(prefs, document.hasFocus(), Date.now())
      if (channel === 'toast')
        showFeedbackToast({
          threadId: notice.threadId,
          count: notice.count,
          title: notice.title,
          preview: notice.preview,
        })
      else if (channel === 'system')
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

  return <FeedbackToast onView={openFeedback} />
}
