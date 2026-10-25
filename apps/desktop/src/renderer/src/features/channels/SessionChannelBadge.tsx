// 会话标题旁的「# 频道 · 成员名」（docs/ui/import-collab.md 第 5 项②）：这个会话加入了频道时显示，点了打开那个频道
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { setPage } from '@/features/layout/page'
import { channelActions, useChannels, useSessionBindings } from './store'

export function SessionChannelBadge({ sessionId }: { sessionId: string }) {
  useI18n()
  const bindings = useSessionBindings(sessionId)
  const channels = useChannels(s => s.channels)
  const members = useChannels(s => s.members)
  const first = bindings.find(b => channels.some(c => c.id === b.channelId))
  if (!first) return null
  const channel = channels.find(c => c.id === first.channelId)!
  const member = members.find(m => m.id === first.memberId)
  const more = bindings.length - 1
  const label = [`# ${channel.name}`, member?.name].filter(Boolean).join(' · ') + (more > 0 ? ` +${more}` : '')
  return (
    <button
      type="button"
      data-session-channel
      title={tr('channels.join.open')}
      onClick={() => {
        setPage('channels')
        channelActions.openNeeds(false)
        channelActions.select(channel.id)
      }}
      className="no-drag max-w-[40%] shrink-0 truncate rounded-md bg-accent-soft px-1.5 text-meta leading-5 text-accent-fg hover:bg-accent-soft/70"
    >
      {label}
    </button>
  )
}
