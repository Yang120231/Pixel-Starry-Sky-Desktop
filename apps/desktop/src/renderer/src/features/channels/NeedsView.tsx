import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage, type TranslationKey } from '../../i18n/core'
import { useState, type ReactNode } from 'react'
import {
  AlarmClock,
  BellRing,
  CircleDashed,
  CircleX,
  Forward,
  Hand,
  HelpCircle,
  ListChecks,
  OctagonPause,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button, IconButton, Popover, PopoverItem, Spinner, useToast } from '@/ui'
import { OPEN_SESSION_EVENT, bridge as engineBridge } from '@/features/engine'
import { relativeTime } from '@/features/engine/labels'
import { canAnswerInline } from '@/features/panel/inbox/inboxModel'
import type { ChannelFollow, ChannelNeed } from '../../../../shared/types/channels'
import type { ChannelAlertAction } from '../../../../shared/channels/alerts'
import { alertActions } from '../../../../shared/channels/alerts'
import { channelActions, useChannels } from './store'
import { snooze, snoozeTimes, useNeeds } from './needs'
import { STATUS_LABEL, waitingText } from './ChannelTaskCard'

const ICON: Record<ChannelNeed['kind'], LucideIcon> = {
  approval: Hand,
  proposal: Forward,
  held: OctagonPause,
  decision: HelpCircle,
  checks: ListChecks,
  failed: CircleX,
  alert: BellRing,
}

const KIND_LABEL: Record<ChannelNeed['kind'], TranslationKey> = {
  approval: 'needs.kind.approval',
  proposal: 'needs.kind.proposal',
  held: 'needs.kind.held',
  decision: 'needs.kind.decision',
  checks: 'needs.kind.checks',
  failed: 'needs.kind.failed',
  alert: 'needs.kind.alert',
}

const ALERT_LABEL: Record<ChannelAlertAction, TranslationKey> = {
  hold: 'alerts.action.hold',
  continue: 'alerts.action.continue',
  open: 'alerts.action.open',
  stop: 'alerts.action.stop',
  reassign: 'alerts.action.reassign',
  cancel: 'alerts.action.cancel',
  dismiss: 'alerts.action.dismiss',
}

const openSession = (sessionId: string) =>
  window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId } }))

/** 跳到频道里那条消息 / 那张卡 */
const show = (channelId: string, id: string | null | undefined) => {
  channelActions.openNeeds(false)
  if (id) void channelActions.focusMessage(channelId, id)
  else channelActions.select(channelId)
}

/** 稍后处理：1 小时后、明天 9 点 */
function Later({ need }: { need: ChannelNeed }) {
  useI18n()
  const [open, setOpen] = useState(false)
  const times = snoozeTimes()
  return (
    <div className="relative">
      <IconButton
        icon={AlarmClock}
        label={tr('needs.later')}
        size={26}
        iconSize={14}
        onClick={() => setOpen(v => !v)}
      />
      <Popover open={open} onClose={() => setOpen(false)} side="bottom" align="end" className="w-44 p-1">
        <PopoverItem
          onClick={() => {
            snooze(need, times.hour)
            setOpen(false)
          }}
        >
          {tr('needs.laterHour')}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            snooze(need, times.tomorrow)
            setOpen(false)
          }}
        >
          {tr('needs.laterTomorrow')}
        </PopoverItem>
      </Popover>
    </div>
  )
}

function Row({
  icon: Icon,
  where,
  text,
  detail,
  at,
  actions,
  data,
}: {
  icon: LucideIcon
  where: string
  text: string
  detail?: ReactNode
  at: number
  actions: ReactNode
  data: string
}) {
  useI18n()
  return (
    <li data-need={data} className="flex min-w-0 items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-hover">
      <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2 text-meta text-fg-faint">
          <span className="min-w-0 truncate">{where}</span>
          <span className="shrink-0 tabular-nums">{relativeTime(at)}</span>
        </div>
        <p className="mt-0.5 text-list break-words text-fg">{text}</p>
        {detail && <p className="mt-0.5 text-meta break-words text-fg-muted">{detail}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>
    </li>
  )
}

/**
 * 「需要你」（docs/ui/channels-collab-v2.md §2）：所有本机频道里等你处理的事，能就地处理的直接处理；
 * 下面是跟进中的活。代替频道页的时间线显示
 */
export function NeedsView() {
  useI18n()
  const toast = useToast()
  const { needs, snoozed, following } = useNeeds()
  const channels = useChannels(s => s.channels)
  const members = useChannels(s => s.members)
  const [busy, setBusy] = useState<string | null>(null)
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? '?'
  const memberName = (id: string | null) => (id ? (members.find(m => m.id === id)?.name ?? '?') : null)
  const where = (n: { channelId: string; memberId: string | null }) =>
    [`# ${channelName(n.channelId)}`, memberName(n.memberId)].filter(Boolean).join(' · ')
  const run = (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    fn()
      .catch(e => toast(tr('needs.failed', { error: translateMessage((e as Error).message) })))
      .finally(() => setBusy(null))
  }
  const small = 'h-7 px-2.5 text-meta'

  const actionsOf = (n: ChannelNeed): ReactNode => {
    const off = busy === n.key
    const view = (
      <Button variant="ghost" className={small} onClick={() => show(n.channelId, n.taskId ?? n.messageId)}>
        {tr('needs.view')}
      </Button>
    )
    switch (n.kind) {
      case 'approval':
        return canAnswerInline(n.request ?? null) && n.sessionId ? (
          <>
            <Button
              variant="primary"
              className={small}
              disabled={off}
              onClick={() =>
                run(n.key, () => engineBridge!.answer(n.sessionId!, n.request!.requestId, { type: 'allow' }))
              }
            >
              {tr('needs.allow')}
            </Button>
            <Button
              className={small}
              disabled={off}
              onClick={() =>
                run(n.key, () => engineBridge!.answer(n.sessionId!, n.request!.requestId, { type: 'deny' }))
              }
            >
              {tr('needs.deny')}
            </Button>
          </>
        ) : (
          <Button variant="primary" className={small} disabled={!n.sessionId} onClick={() => openSession(n.sessionId!)}>
            {tr('needs.answer')}
          </Button>
        )
      case 'proposal':
        return (
          <>
            <Button
              variant="primary"
              className={small}
              disabled={off}
              onClick={() => run(n.key, () => channelActions.proposal(n.channelId, n.messageId!, true))}
            >
              {tr('channels.proposal.send')}
            </Button>
            <Button
              className={small}
              disabled={off}
              onClick={() => run(n.key, () => channelActions.proposal(n.channelId, n.messageId!, false))}
            >
              {tr('channels.proposal.dismiss')}
            </Button>
          </>
        )
      case 'held':
        return (
          <>
            <Button
              variant="primary"
              className={small}
              disabled={off}
              onClick={() => run(n.key, () => channelActions.task(n.taskId!, 'continue'))}
            >
              {tr('needs.continue')}
            </Button>
            {view}
          </>
        )
      case 'decision':
        return (
          <Button
            variant="primary"
            className={small}
            onClick={() => {
              channelActions.openNeeds(false)
              channelActions.select(n.channelId)
              channelActions.openThread(n.channelId, n.taskId!)
            }}
          >
            {tr('needs.answer')}
          </Button>
        )
      case 'checks':
        return (
          <>
            <Button
              variant="primary"
              className={small}
              disabled={off}
              onClick={() => run(n.key, () => channelActions.task(n.taskId!, 'fix'))}
            >
              {tr('checks.fix')}
            </Button>
            {view}
          </>
        )
      case 'failed':
        return (
          <>
            <Button
              variant="primary"
              className={small}
              disabled={off}
              onClick={() => run(n.key, () => channelActions.task(n.taskId!, 'retry'))}
            >
              {tr('needs.retry')}
            </Button>
            {view}
          </>
        )
      case 'alert':
        return (
          <>
            {alertActions(n.rule ?? 'digest').map(action => (
              <Button
                key={action}
                variant={action === alertActions(n.rule ?? 'digest')[0] ? 'primary' : 'outline'}
                className={small}
                disabled={off}
                onClick={() => run(n.key, () => channelActions.alert(n.channelId, n.messageId!, action))}
              >
                {tr(ALERT_LABEL[action])}
              </Button>
            ))}
            {view}
          </>
        )
    }
  }

  const detailOf = (n: ChannelNeed): string | null => {
    if (n.kind === 'approval' && n.request) return waitingText(n.request)
    if (n.kind === 'held') return tr('needs.heldDetail')
    if (n.kind === 'checks')
      return tr('needs.checksDetail', {
        items: [n.detail, n.findings ? tr('checks.findings', { count: n.findings }) : null].filter(Boolean).join(' · '),
      })
    if (n.kind === 'failed' || n.kind === 'decision') return n.detail ? translateMessage(n.detail) : null
    return null
  }

  return (
    <section
      aria-label={tr('needs.title')}
      data-needs-view=""
      className="conversation-view flex min-w-[360px] flex-1 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-5">
        <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-fg">{tr('needs.title')}</h2>
        <IconButton
          icon={X}
          label={tr('needs.close')}
          size={28}
          iconSize={15}
          onClick={() => channelActions.openNeeds(false)}
        />
      </div>
      <div className="selectable min-h-0 flex-1 overflow-y-auto px-3 pb-6 [scrollbar-width:thin]">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <div>
            <h3 className="px-3 pb-1 text-label font-medium text-fg-muted">
              {tr('needs.todo', { count: needs.length })}
              {snoozed > 0 && <span className="ml-2 text-fg-faint">{tr('needs.snoozed', { count: snoozed })}</span>}
            </h3>
            {needs.length === 0 ? (
              <p className="px-3 py-4 text-list text-fg-faint">{tr('needs.empty')}</p>
            ) : (
              <ul className="flex flex-col">
                {needs.map(n => (
                  <Row
                    key={n.key}
                    data={n.kind}
                    icon={ICON[n.kind]}
                    where={`${tr(KIND_LABEL[n.kind])} · ${where(n)}`}
                    text={n.text}
                    detail={detailOf(n)}
                    at={n.at}
                    actions={
                      <>
                        {busy === n.key && <Spinner size={12} />}
                        {actionsOf(n)}
                        <Later need={n} />
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="px-3 pb-1 text-label font-medium text-fg-muted">
              {tr('needs.following', { count: following.length })}
            </h3>
            {following.length === 0 ? (
              <p className="px-3 py-4 text-list text-fg-faint">{tr('needs.followingEmpty')}</p>
            ) : (
              <ul className="flex flex-col">
                {following.map((f: ChannelFollow) => (
                  <Row
                    key={f.taskId}
                    data="following"
                    icon={CircleDashed}
                    where={where(f)}
                    text={f.title}
                    detail={tr(STATUS_LABEL[f.status])}
                    at={f.at}
                    actions={
                      <>
                        {f.sessionId && (
                          <Button className={small} onClick={() => openSession(f.sessionId!)}>
                            {tr('needs.openSession')}
                          </Button>
                        )}
                        <Button variant="ghost" className={small} onClick={() => show(f.channelId, f.taskId)}>
                          {tr('needs.view')}
                        </Button>
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
