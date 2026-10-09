import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Hash, Info, UserPlus, Users } from 'lucide-react'
import { Spinner } from '@/components/ui'
import type { Channel, ChannelEvent, ChannelMember, ChannelMessage, ChannelTextMessage } from '@/data/types'
import { buildTimeline } from './model'
import { formatDay } from './format'
import { MessageGroup } from './ChannelMessage'
import { ChannelTaskCard } from './ChannelTaskCard'

/** 离底部这么近时，新消息到来自动跟到底部 */
const STICK_PX = 80

function eventText(event: ChannelEvent, name: (id: string | null | undefined) => string): string {
  switch (event.event) {
    case 'joined':
      return tr('channels.event.joined', { name: name(event.actorId) })
    case 'added':
      return tr('channels.event.added', { actor: name(event.actorId), name: name(event.targetId) })
    case 'renamed':
      return tr('channels.event.renamed', { actor: name(event.actorId), value: event.value ?? '' })
    case 'topic':
      return tr('channels.event.topic', { actor: name(event.actorId), value: event.value ?? '' })
  }
}

function Divider({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div role="separator" aria-label={label} className="conversation-message my-3 flex items-center gap-3">
      <span className={accent ? 'h-px flex-1 bg-accent' : 'h-px flex-1 bg-line-subtle'} />
      <span className={accent ? 'shrink-0 text-meta font-medium text-accent-fg' : 'shrink-0 text-meta text-fg-faint'}>
        {label}
      </span>
      <span className={accent ? 'h-px flex-1 bg-accent' : 'h-px flex-1 bg-line-subtle'} />
    </div>
  )
}

/** 时间线（docs/ui/channels.md §5）：开头介绍、日期 / 新消息分隔、消息组、任务卡、事件、处理中提示 */
export function ChannelTimeline({
  channel,
  messages,
  members,
  channelMembers,
  newFrom,
  onReply,
  onOpenSession,
}: {
  channel: Channel
  messages: readonly ChannelMessage[]
  members: readonly ChannelMember[]
  channelMembers: readonly ChannelMember[]
  newFrom: number | null
  onReply: (id: string) => void
  onOpenSession: (sessionId: string) => void
}) {
  useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const [highlight, setHighlight] = useState<string | null>(null)
  const rows = useMemo(() => buildTimeline(messages, { newFrom }), [messages, newFrom])
  const membersById = useMemo(() => new Map(members.map(m => [m.id, m])), [members])
  const messagesById = useMemo(
    () => new Map(messages.filter((m): m is ChannelTextMessage => m.kind === 'message').map(m => [m.id, m])),
    [messages],
  )
  const name = (id: string | null | undefined) => (id ? membersById.get(id)?.name : undefined) ?? '?'
  const working = channelMembers.filter(m => m.kind === 'agent' && m.status === 'running')
  const now = Date.now()

  // 换频道：有新消息分隔线就停在它附近，否则到底部
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const divider = el.querySelector<HTMLElement>('[data-new-divider]')
    el.scrollTop = divider ? Math.max(0, divider.offsetTop - 24) : el.scrollHeight
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
    setHighlight(null)
  }, [channel.id])

  // 新消息：原本就在底部附近，或是自己刚发的，就跟到底部
  useLayoutEffect(() => {
    const el = scroller.current,
      last = messages[messages.length - 1]
    const author = last?.kind === 'message' ? membersById.get(last.authorId) : undefined
    const mine = author?.kind === 'human' && !!author.you
    if (el && (nearBottom.current || mine)) el.scrollTop = el.scrollHeight
  }, [messages.length])

  useEffect(() => {
    if (!highlight) return
    const t = window.setTimeout(() => setHighlight(null), 1600)
    return () => window.clearTimeout(t)
  }, [highlight])

  // 只移动时间线自己的滚动区，不用 scrollIntoView（会连带移动外层）
  const jump = (id: string) => {
    const el = scroller.current,
      target = el?.querySelector<HTMLElement>(`[data-channel-message="${CSS.escape(id)}"]`)
    if (!el || !target) return
    const box = el.getBoundingClientRect(),
      row = target.getBoundingClientRect()
    el.scrollTop += row.top - box.top - (box.height - row.height) / 2
    setHighlight(id)
  }

  return (
    <div
      ref={scroller}
      role="log"
      aria-label={`# ${channel.name}`}
      onScroll={e => {
        const el = e.currentTarget
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
      }}
      className="conversation-scroller selectable relative min-h-0 flex-1 overflow-y-auto"
    >
      <div className="conversation-inset conversation-reading flex flex-col pt-6 pb-4">
        <header className="conversation-message mb-2 flex flex-col gap-2">
          <span className="flex size-11 items-center justify-center rounded-xl bg-subtle text-fg-muted">
            {channel.scope === 'team' ? <Users size={20} strokeWidth={1.5} /> : <Hash size={20} strokeWidth={1.5} />}
          </span>
          <h2 className="text-section font-semibold text-fg">{tr('channels.intro.title', { name: channel.name })}</h2>
          {channel.topic && <p className="text-list text-fg-muted">{channel.topic}</p>}
          {messages.length === 0 && <p className="text-list text-fg-faint">{tr('channels.intro.noMessages')}</p>}
        </header>
        {rows.map(row => {
          switch (row.kind) {
            case 'day':
              return <Divider key={row.key} label={formatDay(row.at, now)} />
            case 'new':
              return (
                <div key={row.key} data-new-divider>
                  <Divider label={tr('channels.newMessages')} accent />
                </div>
              )
            case 'event':
              return (
                <div
                  key={row.key}
                  data-channel-message={row.message.id}
                  className="conversation-message mt-3 flex items-center justify-center gap-1.5 text-meta text-fg-faint"
                >
                  {row.message.event === 'joined' || row.message.event === 'added' ? (
                    <UserPlus size={13} strokeWidth={1.5} />
                  ) : (
                    <Info size={13} strokeWidth={1.5} />
                  )}
                  <span className="min-w-0 truncate">{eventText(row.message, name)}</span>
                </div>
              )
            case 'task':
              return (
                <ChannelTaskCard
                  key={row.key}
                  task={row.message}
                  membersById={membersById}
                  onOpenSession={onOpenSession}
                />
              )
            case 'group':
              return (
                <MessageGroup
                  key={row.key}
                  items={row.items}
                  membersById={membersById}
                  channelMembers={channelMembers}
                  messagesById={messagesById}
                  highlight={highlight}
                  onReply={onReply}
                  onJump={jump}
                />
              )
          }
        })}
        {working.length > 0 && (
          <div role="status" className="conversation-message mt-4 flex flex-col gap-1 pl-10">
            {working.map(m => (
              <div key={m.id} className="flex min-w-0 items-center gap-2 text-meta text-fg-muted">
                <Spinner size={12} />
                <span className="min-w-0 truncate">
                  {m.kind === 'agent' && m.task
                    ? tr('channels.working', { name: m.name, task: m.task })
                    : tr('channels.workingNoTask', { name: m.name })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
