import { useI18n } from '@/i18n/I18nProvider'
import { tr, type TranslationKey } from '../i18n/core'
import type { ReactNode } from 'react'
import { ArrowUpRight, Bot, UserPlus, X } from 'lucide-react'
import { Button, cn, IconButton, Spinner, useComingSoon } from '@/components/ui'
import type { AgentMember, Channel, ChannelAgentStatus, ChannelMember, HumanMember } from '@/data/types'
import { agentMeta, MemberAvatar } from './ChannelMessage'

const STATUS_LABEL: Record<ChannelAgentStatus, TranslationKey> = {
  idle: 'channels.status.idle',
  running: 'channels.status.running',
  waiting: 'channels.status.waiting',
  offline: 'channels.status.offline',
}
const STATUS_DOT: Record<Exclude<ChannelAgentStatus, 'running'>, string> = {
  idle: 'bg-fg-faint',
  waiting: 'bg-warn',
  offline: 'bg-fg-faint',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-2 text-label font-medium text-fg-muted">{title}</h3>
      <div className="flex flex-col gap-px">{children}</div>
    </section>
  )
}

function HumanRow({ member }: { member: HumanMember }) {
  useI18n()
  return (
    <div className="flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2">
      <MemberAvatar member={member} size={24} />
      <span className="min-w-0 truncate text-list text-fg">{member.name}</span>
      {member.you && <span className="shrink-0 text-meta text-fg-muted">{tr('channels.youSuffix')}</span>}
      {member.role && (
        <span className="ml-auto shrink-0 text-meta text-fg-faint">
          {tr(member.role === 'owner' ? 'channels.role.owner' : 'channels.role.member')}
        </span>
      )}
    </div>
  )
}

function AgentRow({ member, onOpenSession }: { member: AgentMember; onOpenSession: (id: string) => void }) {
  useI18n()
  const status = tr(STATUS_LABEL[member.status])
  return (
    <div
      className={cn(
        'group/agent flex min-w-0 gap-2.5 rounded-md px-2 py-2 hover:bg-hover',
        member.status === 'offline' && 'opacity-60',
      )}
    >
      <span className="relative mt-0.5 h-fit shrink-0 self-start">
        <MemberAvatar member={member} size={28} />
        {member.status !== 'running' && (
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface',
              STATUS_DOT[member.status],
            )}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-list font-medium text-fg">{member.name}</div>
        <div className="truncate text-meta text-fg-faint">{agentMeta(member)}</div>
        <div
          className={cn(
            'flex min-w-0 items-center gap-1.5 text-meta',
            member.status === 'waiting' ? 'text-warn' : 'text-fg-muted',
          )}
        >
          {member.status === 'running' && <Spinner size={11} />}
          <span className="min-w-0 truncate" title={member.task ? `${status} · ${member.task}` : status}>
            {member.task ?? status}
          </span>
        </div>
      </div>
      {member.sessionId && (
        <IconButton
          icon={ArrowUpRight}
          label={tr('channels.openSession')}
          size={26}
          iconSize={14}
          className="shrink-0"
          onClick={() => onOpenSession(member.sessionId!)}
        />
      )}
    </div>
  )
}

/** 成员面板（docs/ui/channels.md §7）：频道信息、真人成员、AI 成员 */
export function ChannelMembers({
  channel,
  members,
  onClose,
  onOpenSession,
}: {
  channel: Channel
  members: readonly ChannelMember[]
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}) {
  useI18n()
  const comingSoon = useComingSoon()
  const humans = members.filter((m): m is HumanMember => m.kind === 'human')
  const agents = members.filter((m): m is AgentMember => m.kind === 'agent')
  return (
    <aside
      aria-label={tr('channels.members.title')}
      className="flex h-full w-[300px] flex-col border-l border-line-subtle"
    >
      <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4">
        <h2 className="text-ui font-medium text-fg">{tr('channels.members.title')}</h2>
        <IconButton icon={X} label={tr('channels.members.hide')} size={28} iconSize={15} onClick={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 pt-1 pb-4 [scrollbar-width:thin]">
        <dl className="mx-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-list">
          <dt className="text-fg-faint">{tr('channels.members.topic')}</dt>
          <dd className={cn('min-w-0 break-words', channel.topic ? 'text-fg-secondary' : 'text-fg-faint')}>
            {channel.topic ?? tr('channels.members.noTopic')}
          </dd>
          {channel.project && (
            <>
              <dt className="text-fg-faint">{tr('channels.members.project')}</dt>
              <dd className="min-w-0 truncate text-fg-secondary">{channel.project}</dd>
            </>
          )}
          <dt className="text-fg-faint">{tr('channels.members.type')}</dt>
          <dd className="text-fg-secondary">
            {tr(channel.scope === 'team' ? 'channels.scope.team' : 'channels.scope.local')}
          </dd>
        </dl>
        <Section title={tr('channels.members.humans', { count: humans.length })}>
          {humans.map(m => (
            <HumanRow key={m.id} member={m} />
          ))}
        </Section>
        <Section title={tr('channels.members.agents', { count: agents.length })}>
          {agents.map(m => (
            <AgentRow key={m.id} member={m} onOpenSession={onOpenSession} />
          ))}
        </Section>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line-subtle p-3">
        <Button
          icon={Bot}
          className="w-full justify-center"
          onClick={() => comingSoon(tr('channels.members.addAgent'))}
        >
          {tr('channels.members.addAgent')}
        </Button>
        <Button
          icon={UserPlus}
          variant="ghost"
          className="w-full justify-center"
          onClick={() => comingSoon(tr('channels.members.invite'))}
        >
          {tr('channels.members.invite')}
        </Button>
      </div>
    </aside>
  )
}
