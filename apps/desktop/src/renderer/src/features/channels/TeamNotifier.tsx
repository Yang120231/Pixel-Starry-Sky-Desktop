// 团队频道的系统通知（docs/ui/channels-phase-c.md §6.2）：有人 @ 了我，或我的 AI 成员有新活等我同意。
// 窗口级挂载一次，不渲染任何内容；演示模式不工作。遵守通知设置（勿扰、仅在后台时通知、声音），正在看这个频道时不发。
import { useEffect } from 'react'
import { tr } from '../../i18n/core'
import { getPage, setPage } from '@/features/layout/page'
import { getNotificationPrefs } from '@/features/settings/notifications'
import { shouldNotify } from '@/features/feedback/logic'
import { channelActions, channelsBridge, getChannels, selectedChannel, selfIdIn } from './store'
import { channelOfNotice, teamNotice, teamNoticeId } from './teamModel'

/** 重连后补齐的旧消息不提醒：只提醒这么久以内的 */
const RECENT_MS = 10 * 60_000
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function TeamNotifier() {
  useEffect(() => {
    const bridge = window.pixelsky
    if (!bridge || bridge.demo || !channelsBridge) return
    // 同一张卡会因为状态变化反复推送，每条消息只提醒一次
    const seen = new Set<string>()
    const offMessages = channelsBridge.onMessage(({ channelId, message }) => {
      const state = getChannels()
      const channel = state.channels.find(c => c.id === channelId)
      const notice = teamNotice(message, channel, selfIdIn(state, channel?.memberIds))
      if (!notice) return
      const key = `${notice.kind}:${message.id}`
      if (seen.has(key)) return
      if (seen.size > 500) seen.clear()
      seen.add(key)
      const now = Date.now()
      if (now - message.at > RECENT_MS) return
      const focused = document.hasFocus()
      if (focused && getPage() === 'channels' && selectedChannel(state)?.id === channelId) return
      const prefs = getNotificationPrefs()
      if (!shouldNotify(prefs, focused, now)) return
      const name = (id: string) => state.members.find(m => m.id === id)?.name ?? '?'
      const content =
        message.kind === 'task'
          ? {
              title: tr('team.notify.approval', { agent: name(message.assigneeId) }),
              body: tr('team.notify.approvalBody', { author: name(message.authorId), title: message.title }),
            }
          : message.kind === 'message'
            ? {
                title: tr('team.notify.mentioned', { author: name(message.authorId), channel: channel?.name ?? '' }),
                body: message.text.replace(/\s+/g, ' ').trim(),
              }
            : null
      if (!content) return
      void bridge.notifications
        .show({
          id: teamNoticeId(notice),
          title: clip(content.title, 120),
          body: clip(content.body, 300),
          sessionId: null,
          sound: prefs.sound,
          attention: false,
        })
        .catch(() => {})
    })
    // 点通知：主进程已经把窗口带到前台，这里打开频道页并选中那个频道
    const offClicks = bridge.notifications.onClick(({ id }) => {
      const channelId = channelOfNotice(id)
      if (!channelId) return
      setPage('channels')
      // 开着「需要你」时先关掉，让这个频道真的显示出来（显示了才标已读）
      channelActions.openNeeds(false)
      channelActions.select(channelId)
    })
    return () => {
      offMessages()
      offClicks()
    }
  }, [])
  return null
}
