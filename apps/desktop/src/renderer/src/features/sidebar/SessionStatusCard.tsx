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
import { useEngineCatalog } from '@/features/engine/catalog'
import { selfSourceReady } from '@/features/model-channels/channelModel'
import type { SessionPr } from '../../../../shared/types/session-status'
import { useSessionActions } from './SessionActions'
import { PrPanel, openUrl } from './PrCard'
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

/** 鼠标在行上停多久弹出、离开多久关（离开后移到卡上不关） */
const OPEN_DELAY = 450
const CLOSE_DELAY = 250
const CARD_WIDTH = 320
/** 卡和行之间的空隙；卡上伸出同样宽的一段透明过渡区，鼠标走过去不会断开 */
const CARD_GAP = 8

/**
 * 对话行的悬停卡（docs/ui/sidebar-status-icons.md §3、docs/ui/sidebar-pr-v2-mockup.html）：整行悬停 450ms 弹出（不用对准图标），
 * 离开 250ms 后关，移到卡上不关；卡挂在 body 上，贴着整行的右边。这个包装是行里的一个 span（SessionItem 里就是左边那一格），
 * 靠它找到所在的行（data-session-row）挂悬停。没有可讲的（只是在跑 / 新回复、也没有 PR）时不弹
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
  children?: ReactNode
}) {
  const topic = topicOf(status)
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const trigger = useRef<HTMLSpanElement>(null)
  const later = (value: boolean, delay: number): void => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(value), delay)
  }
  const openRef = useRef(open)
  openRef.current = open
  const leave = (): void => later(false, CLOSE_DELAY)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!topic) setOpen(false)
  }, [topic])
  // 挂在整行上（原生事件：卡在 body 下面，从行移到卡会触发行的 pointerleave，卡自己的 enter 再取消关闭）
  useEffect(() => {
    if (!topic) return
    const row = trigger.current?.closest<HTMLElement>('[data-session-row]') ?? trigger.current
    if (!row) return
    const schedule = (value: boolean, delay: number): void => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setOpen(value), delay)
    }
    const enter = (e: PointerEvent): void => {
      // 按着键拖动（拖对话、选字）时不弹
      if (e.buttons) return
      window.clearTimeout(timer.current)
      if (!openRef.current) schedule(true, OPEN_DELAY)
    }
    const leaveRow = (): void => schedule(false, CLOSE_DELAY)
    // 点了这一行（打开对话）就不弹 / 关掉
    const down = (): void => {
      window.clearTimeout(timer.current)
      setOpen(false)
    }
    row.addEventListener('pointerenter', enter)
    row.addEventListener('pointerleave', leaveRow)
    row.addEventListener('pointerdown', down)
    return () => {
      row.removeEventListener('pointerenter', enter)
      row.removeEventListener('pointerleave', leaveRow)
      row.removeEventListener('pointerdown', down)
    }
  }, [topic])
  return (
    <span ref={trigger} className={className}>
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
  const [coords, setCoords] = useState<{
    x: number
    y: number
    side: 'left' | 'right'
    rowTop: number
    rowHeight: number
  } | null>(null)
  const prs = visiblePrs(extra.prs[sessionId])
  const mentioned = extra.mentioned[sessionId] ?? []
  // 问题卡里点「查看 PR」切到 PR 那一面
  const [view, setView] = useState<'topic' | 'pr'>(isPrKind(topic) ? 'pr' : 'topic')
  const request = card?.request ?? null
  const machine = machines.find(m => m.id === machineOf(sessionId))
  const error = card?.lane === 'failed' ? (card.error ?? '') : ''
  const errorKind = errorKindOf(error)
  const engine = record?.engine ?? 'claude'
  // 像素星空没配自己的 Key 时不给「改用自有」（channelModel.ts selfSourceReady）
  const catalog = useEngineCatalog(engine)
  const errorActions: CardActionId[] =
    errorKind === 'failed'
      ? []
      : actionsFor(errorKind, record ?? { platform: null }, engine, selfSourceReady(engine, catalog))
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
      const right = row.right + CARD_GAP
      const fits = right + rect.width <= vw - 8
      const x = fits ? right : Math.max(8, row.left - rect.width - CARD_GAP)
      const y = Math.max(8, Math.min(row.top - 6, vh - rect.height - 8))
      setCoords({ x, y, side: fits ? 'right' : 'left', rowTop: row.top - y, rowHeight: row.height })
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

  const text = describeTopic(topic, {
    card,
    record,
    machineName: machine?.name,
    machineError: machine?.error,
    error,
    limitAt: status.limitAt,
  })
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
      {coords && (
        // 行和卡之间那段空隙的过渡区：透明，属于卡，鼠标从行走过去不算离开
        <span
          aria-hidden
          className="absolute"
          style={{
            top: coords.rowTop,
            height: coords.rowHeight,
            width: CARD_GAP + 2,
            [coords.side === 'right' ? 'right' : 'left']: '100%',
          }}
        />
      )}
      {view === 'pr' ? (
        <PrPanel
          sessionId={sessionId}
          title={title}
          prs={prs}
          mentioned={mentioned}
          gh={extra.gh}
          busy={busy}
          onRefresh={() => run('refresh')}
          onBack={isPrKind(topic) ? undefined : () => setView('topic')}
        />
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
          {status.hasPrs && (
            <PrLine
              pr={pr}
              count={prs.length + mentioned.length}
              onOpen={() => pr && void openUrl(pr.url, toast)}
              onView={() => setView('pr')}
            />
          )}
        </>
      )}
      {view === 'topic' && (
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
          <Button
            className="h-7 px-2.5 text-meta"
            onClick={() => {
              openSession(sessionId)
              onClose()
            }}
          >
            {tr('sidebar.status.openChat')}
          </Button>
        </div>
      )}
    </div>
  )
}

const ACTION_KEY = {
  allow: 'sidebar.status.allow',
  deny: 'sidebar.status.deny',
  resume: 'sidebar.status.resume',
  archive: 'sidebar.status.archive',
  reconnect: 'sidebar.status.reconnect',
  refresh: 'sidebar.status.refresh',
} as const satisfies Partial<Record<CardActionId, Parameters<typeof tr>[0]>>

/** 问题卡下面附的一行 PR：点标题打开，右边「查看 PR」切到 PR 那一面（图标藏了的也能在那里恢复） */
function PrLine({
  pr,
  count,
  onOpen,
  onView,
}: {
  pr: SessionPr | null
  count: number
  onOpen: () => void
  onView: () => void
}) {
  const { icon: Icon, tone } = prIcon(pr)
  return (
    <div className="flex min-w-0 items-center gap-1.5 border-t border-line-subtle pt-2 text-meta text-fg-secondary">
      <Icon size={13} strokeWidth={1.5} className={cn('shrink-0', pr ? tone : 'text-fg-faint')} />
      {pr ? (
        <button
          type="button"
          onClick={onOpen}
          title={pr.title}
          className="flex min-w-0 flex-1 gap-1.5 text-left hover:text-fg"
        >
          <span className="shrink-0 tabular-nums">#{pr.number}</span>
          <span className="min-w-0 truncate">{pr.title}</span>
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate">{tr('sidebar.status.pr.count', { count })}</span>
      )}
      <button type="button" onClick={onView} className="shrink-0 text-fg-muted hover:text-fg">
        {tr('sidebar.status.pr.view')}
      </button>
    </div>
  )
}
