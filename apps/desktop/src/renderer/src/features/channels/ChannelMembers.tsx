import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage, type TranslationKey } from '../../i18n/core'
import { useState, type ReactNode } from 'react'
import { ArrowUpRight, Bot, ChevronDown, Ellipsis, Pencil, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { Button, cn, IconButton, Spinner, useComingSoon, useToast } from '@/ui'
import { ActionMenu, type MenuAction } from '@/ui/ActionMenu'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { relativeTime } from '@/features/engine'
import type { AgentMember, Channel, ChannelAgentStatus, ChannelMember, HumanMember } from '@/data/types'
import type { AgentConfig, ChannelTaskStatus } from '../../../../shared/types/channels'
import { agentMeta, MemberAvatar } from './ChannelMessage'
import { AgentDialog, ChannelDialog } from './ChannelDialogs'
import { channelActions, channelsLive } from './store'

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
const TASK_LABEL: Record<ChannelTaskStatus, TranslationKey> = {
  queued: 'channels.task.queued',
  running: 'channels.task.running',
  waiting: 'channels.task.waiting',
  done: 'channels.task.done',
  failed: 'channels.task.failed',
  stopped: 'channels.task.stopped',
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

/** 第 3 行：当前任务（另有 N 项排队），空闲时上一项的结果 */
function agentLine(member: AgentMember, now: number): string {
  if (member.task)
    return member.queued ? `${member.task} · ${tr('channels.members.queued', { count: member.queued })}` : member.task
  if (member.status === 'idle' && member.last)
    return tr('channels.members.last', {
      status: tr(TASK_LABEL[member.last.status]),
      time: relativeTime(member.last.at, now),
    })
  return tr(STATUS_LABEL[member.status])
}

/** 档案（docs/ui/channels-phase-b.md §8）：职责、工作方式、最近 30 天、目录 */
function AgentDetails({ member }: { member: AgentMember }) {
  useI18n()
  const config = member.config
  if (!config) return null
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 rounded-md bg-subtle px-2 py-1.5 text-meta">
      {config.instructions.trim() && (
        <>
          <dt className="text-fg-faint">{tr('channels.members.instructions')}</dt>
          <dd className="line-clamp-3 min-w-0 break-words text-fg-secondary">{config.instructions}</dd>
        </>
      )}
      <dt className="text-fg-faint">{tr('channels.members.mode')}</dt>
      <dd className="text-fg-secondary">
        {tr(config.mode === 'shared' ? 'channels.agent.mode.shared' : 'channels.agent.mode.perTask')}
      </dd>
      {member.stats && <dd className="col-span-2 text-fg-muted">{tr('channels.members.stats', member.stats)}</dd>}
    </dl>
  )
}

function AgentRow({
  member,
  live,
  onOpenSession,
  onEdit,
  onRemove,
}: {
  member: AgentMember
  live: boolean
  onOpenSession: (id: string) => void
  onEdit: (config: AgentConfig) => void
  onRemove: (member: AgentMember) => void
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const line = agentLine(member, Date.now())
  const status = tr(STATUS_LABEL[member.status])
  const actions: MenuAction[] = [
    ...(member.config ? [{ label: tr('channels.members.edit'), icon: Pencil, run: () => onEdit(member.config!) }] : []),
    ...(member.sessionId
      ? [{ label: tr('channels.openSession'), icon: ArrowUpRight, run: () => onOpenSession(member.sessionId!) }]
      : []),
    {
      label: tr('channels.members.remove'),
      icon: UserMinus,
      danger: true,
      separator: true,
      run: () => onRemove(member),
    },
  ]
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
        {live && member.config ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={tr('channels.members.details', { name: member.name })}
            onClick={() => setOpen(v => !v)}
            className="flex max-w-full min-w-0 items-center gap-1 text-left text-list font-medium text-fg"
          >
            <span className="truncate">{member.name}</span>
            <ChevronDown
              size={12}
              className={cn('shrink-0 text-fg-faint transition-transform', open && 'rotate-180')}
            />
          </button>
        ) : (
          <div className="truncate text-list font-medium text-fg">{member.name}</div>
        )}
        <div className="truncate text-meta text-fg-faint">
          {[agentMeta(member), member.project].filter(Boolean).join(' · ')}
        </div>
        <div
          className={cn(
            'flex min-w-0 items-center gap-1.5 text-meta',
            member.status === 'waiting' ? 'text-warn' : 'text-fg-muted',
          )}
        >
          {member.status === 'running' && <Spinner size={11} />}
          <span className="min-w-0 truncate" title={member.task ? `${status} · ${line}` : line}>
            {line}
          </span>
        </div>
        {member.warning && <div className="text-meta text-warn">{translateMessage(member.warning)}</div>}
        {!!member.sharesDirWith?.length && (
          <div className="text-meta text-fg-faint">
            {tr('channels.members.sharesDir', { names: member.sharesDirWith.join('、') })}
          </div>
        )}
        {open && <AgentDetails member={member} />}
      </div>
      {live ? (
        <IconButton
          icon={Ellipsis}
          label={tr('channels.members.menu', { name: member.name })}
          size={26}
          iconSize={14}
          className="shrink-0 opacity-0 group-hover/agent:opacity-100 focus-visible:opacity-100"
          onClick={e => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.right - 180, y: r.bottom + 4 })
          }}
        />
      ) : (
        member.sessionId && (
          <IconButton
            icon={ArrowUpRight}
            label={tr('channels.openSession')}
            size={26}
            iconSize={14}
            className="shrink-0"
            onClick={() => onOpenSession(member.sessionId!)}
          />
        )
      )}
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={tr('channels.members.menu', { name: member.name })}
          actions={actions}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/** 成员面板（docs/ui/channels.md §7，Phase B 见 channels-phase-b.md §8）：频道信息、真人成员、AI 成员 */
export function ChannelMembers({
  channel,
  members,
  allMembers,
  onClose,
  onOpenSession,
}: {
  channel: Channel
  members: readonly ChannelMember[]
  /** 全部成员（「从已有成员添加」用） */
  allMembers: readonly ChannelMember[]
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}) {
  useI18n()
  const comingSoon = useComingSoon()
  const toast = useToast()
  const live = channelsLive
  const [dialog, setDialog] = useState<
    | { kind: 'agent'; editing: AgentConfig | null }
    | { kind: 'channel' }
    | { kind: 'delete' }
    | { kind: 'remove'; member: AgentMember }
    | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number } | null>(null)
  const humans = members.filter((m): m is HumanMember => m.kind === 'human')
  const agents = members.filter((m): m is AgentMember => m.kind === 'agent')
  const others = allMembers.filter((m): m is AgentMember => m.kind === 'agent' && !channel.memberIds.includes(m.id))
  const confirm = (fn: () => Promise<void>) => {
    setBusy(true)
    fn()
      .then(
        () => setDialog(null),
        e => toast(tr('channels.task.actionFailed', { error: translateMessage((e as Error).message) })),
      )
      .finally(() => setBusy(false))
  }
  return (
    <aside
      aria-label={tr('channels.members.title')}
      className="flex h-full w-[300px] flex-col border-l border-line-subtle"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-1 pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-fg">{tr('channels.members.title')}</h2>
        {live && (
          <IconButton
            icon={Ellipsis}
            label={tr('channels.members.channelMenu')}
            size={28}
            iconSize={15}
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              setChannelMenu({ x: r.right - 180, y: r.bottom + 4 })
            }}
          />
        )}
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
            <AgentRow
              key={m.id}
              member={m}
              live={live}
              onOpenSession={onOpenSession}
              onEdit={config => setDialog({ kind: 'agent', editing: config })}
              onRemove={member => setDialog({ kind: 'remove', member })}
            />
          ))}
        </Section>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line-subtle p-3">
        <Button
          icon={Bot}
          className="w-full justify-center"
          onClick={() =>
            live ? setDialog({ kind: 'agent', editing: null }) : comingSoon(tr('channels.members.addAgent'))
          }
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
      {channelMenu && (
        <ActionMenu
          x={channelMenu.x}
          y={channelMenu.y}
          label={tr('channels.members.channelMenu')}
          actions={[
            { label: tr('channels.channel.edit'), icon: Pencil, run: () => setDialog({ kind: 'channel' }) },
            {
              label: tr('channels.channel.delete'),
              icon: Trash2,
              danger: true,
              separator: true,
              run: () => setDialog({ kind: 'delete' }),
            },
          ]}
          onClose={() => setChannelMenu(null)}
        />
      )}
      {dialog?.kind === 'agent' && (
        <AgentDialog channel={channel} editing={dialog.editing} others={others} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'channel' && <ChannelDialog channel={channel} agents={[]} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          danger
          title={tr('channels.channel.deleteTitle', { name: channel.name })}
          description={tr('channels.channel.deleteBody')}
          confirmLabel={tr('channels.channel.deleteConfirm')}
          cancelLabel={tr('channels.dialog.cancel')}
          busy={busy}
          onConfirm={() => confirm(() => channelActions.deleteChannel(channel.id))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          danger
          title={tr('channels.members.removeTitle', { name: dialog.member.name })}
          description={
            dialog.member.task || dialog.member.queued
              ? tr('channels.members.removeBody', { count: (dialog.member.task ? 1 : 0) + (dialog.member.queued ?? 0) })
              : tr('channels.members.removeBodyIdle')
          }
          confirmLabel={tr('channels.members.remove')}
          cancelLabel={tr('channels.dialog.cancel')}
          busy={busy}
          onConfirm={() => confirm(() => channelActions.removeMember(channel.id, dialog.member.id))}
          onCancel={() => setDialog(null)}
        />
      )}
    </aside>
  )
}
