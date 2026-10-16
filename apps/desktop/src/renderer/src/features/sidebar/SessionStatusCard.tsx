import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Button, cn, useToast } from '@/ui'
import { isDemo } from '@/data'
import type { SessionCard } from '@/features/board/sessionLanes'
import { bridge, demoRetry, requestSourceActionAfterOpen, useEngineState, type SourceAction } from '@/features/engine'
import { OPEN_SESSION_EVENT } from '@/features/engine/openRequests'
import { resolveDemoInbox } from '@/features/panel/inbox/useInbox'
import { useAccount } from '@/features/account/useAccount'
import { useSettings } from '@/features/settings/SettingsProvider'
import { machineOf, openMachineManager, useMachines } from '@/features/machines/store'
import { SOURCE_ACTION_LABEL, actionsFor } from '@/features/session/live/NoticeActions'
import type { SessionPr } from '../../../../shared/types/session-status'
import { useSessionActions } from './SessionActions'
import { StatusGlyph, prIcon } from './SessionMarks'
import {
  cardActions,
  errorKindOf,
  isPrKind,
  topicOf,
  visiblePrs,
  type CardActionId,
  type SessionStatus,
  type StatusKind,
} from './sessionStatusModel'
import { refreshSessionStatus, useSessionStatus } from './useSessionStatus'
import { describeTopic } from './sessionStatusText'

/** 鼠标在状态格上停多久弹出、离开多久关（离开后移到卡上不关） */
const OPEN_DELAY = 300
const CLOSE_DELAY = 150
const CARD_WIDTH = 320

/**
 * 状态格的悬停卡（docs/ui/sidebar-status-icons.md §3）：停 300ms 弹出，离开 150ms 后关，移到卡上不关；
 * 卡挂在 body 上，贴着整行的右边。这个包装本身是个 span，位置 / 大小由 className 决定（SessionItem 里是绝对定位的那一格）。
 * 没有可讲的（只是在跑 / 新回复且没有 PR）时不弹
 */
export function StatusHover({
  sessionId,
  title,
  status,
  card,
  className,
  children,
}: {
  sessionId: string
  title: string
  status: SessionStatus
  card?: SessionCard | null
  className?: string
  children: ReactNode
}) {
  const topic = topicOf(status)
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const trigger = useRef<HTMLSpanElement>(null)
  const later = (value: boolean, delay: number): void => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(value), delay)
  }
  const enter = (): void => {
    if (!topic) return
    window.clearTimeout(timer.current)
    if (!open) later(true, OPEN_DELAY)
  }
  const leave = (): void => later(false, CLOSE_DELAY)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!topic) setOpen(false)
  }, [topic])
  return (
    <span ref={trigger} className={className} onPointerEnter={enter} onPointerLeave={leave}>
      {children}
      {open &&
        topic &&
        createPortal(
          <StatusCard
            sessionId={sessionId}
            title={title}
            topic={topic}
            status={status}
            card={card ?? null}
            anchor={() => trigger.current?.closest<HTMLElement>('[data-session-row]') ?? trigger.current}
            onEnter={() => window.clearTimeout(timer.current)}
            onLeave={leave}
            onClose={() => {
              window.clearTimeout(timer.current)
              setOpen(false)
            }}
          />,
          document.body,
        )}
    </span>
  )
}

const openSession = (sessionId: string): void =>
  void window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId } }))

function StatusCard({
  sessionId,
  title,
  topic,
  status,
  card,
  anchor,
  onEnter,
  onLeave,
  onClose,
}: {
  sessionId: string
  title: string
  topic: StatusKind
  status: SessionStatus
  card: SessionCard | null
  anchor: () => HTMLElement | null
  onEnter: () => void
  onLeave: () => void
  onClose: () => void
}) {
  useI18n()
  const toast = useToast()
  const settings = useSettings()
  const account = useAccount()
  const sessionActions = useSessionActions()
  const extra = useSessionStatus()
  const machines = useMachines().machines
  const record = useEngineState(
    s => s.snapshots[sessionId]?.record ?? s.sessions.find(x => x.record.id === sessionId)?.record,
  )
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null)
  const prs = visiblePrs(extra.prs[sessionId])
  const request = card?.request ?? null
  const machine = machines.find(m => m.id === machineOf(sessionId))
  const error = card?.lane === 'failed' ? (card.error ?? '') : ''
  const errorKind = errorKindOf(error)
  const errorActions: CardActionId[] =
    errorKind === 'failed' ? [] : actionsFor(errorKind, record ?? { platform: null }, record?.engine ?? 'claude')
  const actions = cardActions(topic, { request, queue: card?.queue ?? null, errorActions })
  const pr = status.pr

  // 贴着整行的右边；右边放不下就放左边，上下夹在窗口里
  useLayoutEffect(() => {
    const el = ref.current,
      row = anchor()?.getBoundingClientRect()
    if (!el || !row) return
    const vw = window.innerWidth,
      vh = window.innerHeight
    const place = (): void => {
      const rect = el.getBoundingClientRect()
      const right = row.right + 8
      const x = right + rect.width <= vw - 8 ? right : Math.max(8, row.left - rect.width - 8)
      setCoords({ x, y: Math.max(8, Math.min(row.top - 6, vh - rect.height - 8)) })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchor 只读 ref
  }, [])
  // 滚动 / 缩放 / 按 Esc / 点到别处就关（行的位置变了，卡不跟着动）
  useEffect(() => {
    const scroll = (e: Event): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const down = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', down, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('scroll', scroll, true)
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const fail = (e: unknown): void => toast(translateMessage(e instanceof Error ? e.message : String(e)))
  const work = async (fn: () => Promise<unknown> | void, close = true): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      if (close) onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  /** 要输入框来做的（重试、选线路、换额度来源）：先打开会话，输入框挂上后执行 */
  const viaComposer = (action: SourceAction): void => {
    if (isDemo && action === 'retry') demoRetry(sessionId)
    else requestSourceActionAfterOpen(sessionId, action)
    openSession(sessionId)
    onClose()
  }
  const run = (id: CardActionId): void => {
    switch (id) {
      case 'allow':
      case 'deny':
        return void work(() =>
          isDemo ? resolveDemoInbox(sessionId) : bridge!.answer(sessionId, request!.requestId, { type: id }),
        )
      case 'resume':
        return void work(() => (isDemo ? resolveDemoInbox(sessionId) : bridge!.resumeQueue(sessionId)))
      case 'archive':
        sessionActions.request('archive', { id: sessionId, title, archived: false, running: false })
        return onClose()
      case 'reconnect':
        return void work(async () => {
          const result = machine && !isDemo ? await window.pixelsky?.machines.connect(machine.id) : undefined
          // 首次信任指纹、指纹变了这类要确认的，交给机器管理窗口
          if (!result?.connected) openMachineManager()
        })
      case 'sign-in':
        return void work(() => account.login())
      case 'open-account':
        settings.openSettings('account')
        return onClose()
      case 'edit-provider':
        settings.openSettings('models')
        return onClose()
      case 'retry':
      case 'open-menu':
      case 'use-self':
      case 'use-platform':
        return viaComposer(id)
      case 'open-pr':
        return void work(() => window.pixelsky?.projectTools.openExternal(pr!.url), false)
      case 'copy-pr':
        return void work(async () => {
          await navigator.clipboard.writeText(pr!.url)
          toast(tr('sidebar.status.copied'))
        }, false)
      case 'refresh':
        return void work(() => refreshSessionStatus(sessionId), false)
    }
  }
  const label = (id: CardActionId): string =>
    id === 'retry' || id === 'open-menu' || id === 'use-self' || id === 'use-platform'
      ? SOURCE_ACTION_LABEL[id]
      : id === 'open-account' || id === 'sign-in' || id === 'edit-provider'
        ? SOURCE_ACTION_LABEL[id]
        : tr(ACTION_KEY[id])

  const text = describeTopic(topic, { card, record, machineName: machine?.name, machineError: machine?.error, error })
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={tr('sidebar.status.label')}
      data-status-card={topic}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      // 卡在行的按钮里面渲染（React 事件会穿过 portal 冒上去）：点卡不能当成点了这一行，也不弹行的右键菜单
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      className="pop-in no-drag fixed z-[70] flex flex-col gap-2 rounded-[10px] border border-line-card bg-popover px-3 py-2.5 text-ui text-fg shadow-menu"
      style={{
        width: CARD_WIDTH,
        maxWidth: 'calc(100vw - 16px)',
        left: coords?.x ?? 0,
        top: coords?.y ?? 0,
        visibility: coords ? 'visible' : 'hidden',
      }}
    >
      {isPrKind(topic) ? (
        <PrList prs={prs.length ? prs : pr ? [pr] : []} gh={extra.gh} onOpen={url => void openUrl(url, toast)} />
      ) : (
        <>
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 flex shrink-0">
              <StatusGlyph kind={topic} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{text.title}</p>
              {text.detail && (
                <p
                  title={text.detail}
                  className={cn(
                    'mt-0.5 line-clamp-3 break-words text-meta text-fg-muted',
                    text.mono && 'font-mono [overflow-wrap:anywhere]',
                  )}
                >
                  {text.detail}
                </p>
              )}
              {text.note && <p className="mt-0.5 text-meta text-fg-muted">{text.note}</p>}
            </div>
          </div>
          {pr && <PrLine pr={pr} onOpen={() => void openUrl(pr.url, toast)} />}
        </>
      )}
      <div className="flex flex-wrap gap-1.5">
        {actions.map((id, index) => (
          <Button
            key={id}
            variant={index === 0 && (id === 'allow' || id === 'retry') ? 'primary' : 'outline'}
            className="h-7 px-2.5 text-meta"
            disabled={busy}
            onClick={() => run(id)}
          >
            {label(id)}
          </Button>
        ))}
        {!isPrKind(topic) && (
          <Button
            className="h-7 px-2.5 text-meta"
            onClick={() => {
              openSession(sessionId)
              onClose()
            }}
          >
            {tr('sidebar.status.openChat')}
          </Button>
        )}
      </div>
    </div>
  )
}

const ACTION_KEY = {
  allow: 'sidebar.status.allow',
  deny: 'sidebar.status.deny',
  resume: 'sidebar.status.resume',
  archive: 'sidebar.status.archive',
  reconnect: 'sidebar.status.reconnect',
  'open-pr': 'sidebar.status.openPr',
  'copy-pr': 'sidebar.status.copyLink',
  refresh: 'sidebar.status.refresh',
} as const satisfies Partial<Record<CardActionId, Parameters<typeof tr>[0]>>

function openUrl(url: string, toast: (message: string) => void): Promise<void> {
  return Promise.resolve(window.pixelsky?.projectTools.openExternal(url)).then(
    () => undefined,
    (e: unknown) => toast(e instanceof Error ? e.message : String(e)),
  )
}

const CI_TONE = { pass: 'text-success', fail: 'text-danger', pending: 'text-fg-muted' } as const

/** 状态卡（非 PR）下面附的一行 PR */
function PrLine({ pr, onOpen }: { pr: SessionPr; onOpen: () => void }) {
  const { icon: Icon, tone } = prIcon(pr)
  return (
    <button
      type="button"
      onClick={onOpen}
      title={pr.title}
      className="flex min-w-0 items-center gap-1.5 rounded-md border-t border-line-subtle pt-2 text-left text-meta text-fg-secondary hover:text-fg"
    >
      <Icon size={13} strokeWidth={1.5} className={cn('shrink-0', tone)} />
      <span className="shrink-0 tabular-nums">#{pr.number}</span>
      <span className="min-w-0 truncate">{pr.title}</span>
    </button>
  )
}

/** PR 卡：每个 PR 一块，点标题在浏览器打开 */
function PrList({ prs, gh, onOpen }: { prs: SessionPr[]; gh: string; onOpen: (url: string) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      {prs.map(pr => {
        const { icon: Icon, tone } = prIcon(pr)
        return (
          <div key={pr.url} data-status-pr={pr.number} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(pr.url)}
              title={pr.title}
              className="flex w-full min-w-0 items-start gap-2 text-left hover:underline"
            >
              <Icon size={16} strokeWidth={1.5} className={cn('mt-0.5 shrink-0', tone)} />
              <span className="min-w-0 break-words font-medium">
                #{pr.number} {pr.title}
              </span>
            </button>
            <p className="mt-0.5 truncate pl-6 text-meta text-fg-muted" title={`${pr.repo} · ${pr.head} → ${pr.base}`}>
              {pr.repo} · {pr.head} → {pr.base}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-6 text-meta">
              {pr.unknown ? (
                <span className="text-fg-muted">
                  {tr(
                    gh === 'signed-out'
                      ? 'sidebar.status.pr.unknownSignedOut'
                      : gh === 'missing'
                        ? 'sidebar.status.pr.unknownMissing'
                        : 'sidebar.status.pr.unknownReady',
                  )}
                </span>
              ) : (
                <>
                  <span className="text-fg-secondary">{tr(PR_STATE[pr.state])}</span>
                  <span className="tabular-nums">
                    <span className="text-success">+{pr.additions}</span>{' '}
                    <span className="text-danger">−{pr.deletions}</span>
                  </span>
                  {pr.ci && (
                    <span className={CI_TONE[pr.ci]}>
                      {pr.ci === 'pass'
                        ? tr('sidebar.status.pr.ciPass')
                        : pr.ci === 'pending'
                          ? tr('sidebar.status.pr.ciPending')
                          : pr.ciFailed > 0
                            ? tr('sidebar.status.pr.ciFail', { count: pr.ciFailed })
                            : tr('sidebar.status.pr.ciFailAny')}
                    </span>
                  )}
                  {pr.conflict && <span className="text-warn">{tr('sidebar.status.pr.conflict')}</span>}
                </>
              )}
            </p>
          </div>
        )
      })}
    </div>
  )
}

const PR_STATE = {
  open: 'sidebar.status.pr.open',
  draft: 'sidebar.status.pr.draft',
  merged: 'sidebar.status.pr.merged',
  closed: 'sidebar.status.pr.closed',
} as const satisfies Record<SessionPr['state'], Parameters<typeof tr>[0]>
