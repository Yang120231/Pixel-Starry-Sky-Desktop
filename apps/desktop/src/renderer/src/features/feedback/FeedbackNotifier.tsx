// 团队回复的系统通知（docs/ui/feedback.md §2.6）：窗口级挂载一次，不渲染任何内容；演示模式不工作。
// 每条回复只提醒一次由主进程保证（change.fresh 里每条只出现一次）；这里按通知设置（勿扰、仅在后台时通知、声音）决定弹不弹。
import { useEffect } from 'react'
import { tr } from '../../i18n/core'
import { getNotificationPrefs } from '@/features/settings/notifications'
import { freshNotice, shouldNotify } from './logic'
import { isDemoFeedback, onFeedbackChange } from './store'

export function FeedbackNotifier() {
  useEffect(() => {
    const bridge = window.pixelsky
    if (!bridge || bridge.demo || isDemoFeedback()) return
    return onFeedbackChange(change => {
      const notice = freshNotice(change.fresh)
      if (!notice) return
      const prefs = getNotificationPrefs()
      if (!shouldNotify(prefs, document.hasFocus(), Date.now())) return
      void bridge.notifications
        .show({
          id: notice.id,
          title: notice.count > 1 ? tr('feedback.notify.titleMany', { p0: notice.count }) : tr('feedback.notify.title'),
          body: notice.body,
          sessionId: null,
          sound: prefs.sound,
          attention: false,
        })
        .catch(() => {})
    })
  }, [])
  return null
}
