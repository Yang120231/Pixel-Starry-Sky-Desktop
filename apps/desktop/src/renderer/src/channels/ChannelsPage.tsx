import { useI18n } from '@/i18n/I18nProvider'
import { useEffect, useMemo, useRef } from 'react'
import { CollapsibleSlot } from '@/components/ui'
import { OPEN_SESSION_EVENT } from '@/engine'
import type { ChannelTextMessage } from '@/mock/types'
import { channelActions, selectedChannel, selfMember, useChannels } from './store'
import { ChannelList } from './ChannelList'
import { ChannelTimeline } from './ChannelTimeline'
import { ChannelComposer } from './ChannelComposer'
import { ChannelMembers } from './ChannelMembers'
import { ChannelsEmpty } from './ChannelsEmpty'

const MEMBERS_WIDTH = 300
const NO_MESSAGES: never[] = []

/** 「打开会话」：交给现有的打开请求处理（切机器、打开会话、切回工作台） */
const openSession = (sessionId: string) => window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId } }))

/**
 * 协作频道整页（docs/ui/channels.md）：频道列表 + 时间线 / 输入框 + 成员面板。
 * 叠在工作台上面显示，只在频道页时挂载；状态都在 channels/store.ts，切走再回来不丢。
 */
export function ChannelsPage({ membersShown, onToggleMembers }: { membersShown: boolean; onToggleMembers: () => void }) {
  useI18n()
  const composer = useRef<HTMLTextAreaElement>(null)
  const channels = useChannels(s => s.channels)
  const members = useChannels(s => s.members)
  const messageMap = useChannels(s => s.messages)
  const replyMap = useChannels(s => s.replyTo)
  const newFromMap = useChannels(s => s.newFrom)
  const channel = useChannels(selectedChannel)
  const self = useChannels(selfMember)
  const messages = (channel && messageMap[channel.id]) || NO_MESSAGES
  const channelMembers = useMemo(() => (channel ? members.filter(m => channel.memberIds.includes(m.id)) : []), [members, channel])
  const replyId = channel ? replyMap[channel.id] ?? null : null
  const replyTo = useMemo(() => (replyId ? messages.find((m): m is ChannelTextMessage => m.kind === 'message' && m.id === replyId) ?? null : null), [messages, replyId])

  // 进入页面或切换频道：标为已读，记下「新消息」位置
  useEffect(() => { if (channel) channelActions.select(channel.id) }, [channel?.id])

  // 从顶栏 / 命令面板切过来时焦点可能落回 body（工作台变成 inert），交给输入框
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) composer.current?.focus() })
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!channel) return <div className="absolute inset-0 flex min-w-0"><ChannelsEmpty /></div>

  const reply = (id: string) => { channelActions.setReplyTo(channel.id, id); composer.current?.focus() }
  const closeMembers = () => { onToggleMembers(); composer.current?.focus() }
  return (
    <div className="@container absolute inset-0 flex min-w-0" data-channels-page>
      <ChannelList channels={channels} selectedId={channel.id} onSelect={channelActions.select} />
      <section aria-label={`# ${channel.name}`} className="conversation-view flex min-w-[360px] flex-1 flex-col">
        <ChannelTimeline channel={channel} messages={messages} members={members} channelMembers={channelMembers}
          newFrom={newFromMap[channel.id] ?? null} onReply={reply} onOpenSession={openSession} />
        <ChannelComposer key={channel.id} channel={channel} members={channelMembers} selfId={self?.id ?? null}
          replyTo={replyTo} replyAuthor={replyTo ? members.find(m => m.id === replyTo.authorId) : undefined}
          onSend={text => channelActions.send(channel.id, text)} onCancelReply={() => channelActions.setReplyTo(channel.id, null)} inputRef={composer} />
      </section>
      <CollapsibleSlot open={membersShown} width={MEMBERS_WIDTH} side="right">
        <ChannelMembers channel={channel} members={channelMembers} onClose={closeMembers} onOpenSession={openSession} />
      </CollapsibleSlot>
    </div>
  )
}
