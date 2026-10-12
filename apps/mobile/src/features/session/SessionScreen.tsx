// 会话页：按轮显示对话（向上加载更早的）、审批 / 提问卡片、停止、回到最新；输入框由 App 传进来（features 之间不互相导入）。
// 输入框上面是消息队列；点图片全屏看；最近一轮出错可以「重试」（docs/mobile-remote.md §17）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, Square } from 'lucide-react'
import type { ApprovalDecision } from '@pixelsky/protocol'
import type { Pairing } from '@/connection'
import { useDesktop, useSession } from '@/data/hooks'
import { RETRY_MESSAGE, groupTurns, retryNoticeId } from '@/data/turns'
import { linkStateText, sessionStateText } from '@/i18n/zh'
import { Banner, Dot, Screen, Spinner, cn } from '@/ui'
import { ImageViewer } from '@/ui/images'
import { ApprovalCard } from './ApprovalCard'
import { TurnBlock, type TurnActions } from './ItemView'
import { QueuePanel } from './QueuePanel'

export function SessionScreen({
  pairing,
  sessionId,
  leading,
  composer,
  onRecall,
}: {
  pairing: Pairing
  sessionId: string
  /** 窄屏左上角的抽屉按钮（宽屏抽屉常驻，按钮自己藏起来） */
  leading?: ReactNode
  composer: ReactNode
  /** 队列里撤回的消息：文字放回输入框 */
  onRecall(text: string): void
}) {
  const { link, state, sessions, projects } = useDesktop(pairing.deviceId)
  const { view, error, loadOlder, detail, image } = useSession(pairing.deviceId, sessionId)
  const summary = sessions.find(s => s.record.id === sessionId)
  const snapshot = view.snapshot
  const running = snapshot ? !!snapshot.turnId : summary?.state === 'running'
  const canAct = state === 'ready' && link?.hello?.access === 'act'
  const pending = snapshot?.pending[0]
  const turns = useMemo(() => groupTurns(snapshot?.items ?? []), [snapshot?.items])
  const record = snapshot?.record ?? summary?.record
  const project = projects.find(p => p.id === record?.projectId)?.name
  const sessionState = pending ? 'waiting' : running ? 'running' : (summary?.state ?? 'idle')

  // 新内容到了、而且本来就在底部时，跟着滚到底；不在底部时显示「回到最新」
  const scroller = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const stick = useRef(true)
  const last = snapshot?.items.at(-1)
  const lastSize = last ? JSON.stringify(last).length : 0
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [snapshot?.items.length, lastSize, pending?.requestId])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      stick.current = bottom
      setAtBottom(bottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const answer = async (d: ApprovalDecision) => {
    if (link && pending) await link.call('engine:answer', sessionId, pending.requestId, d)
  }

  // 全屏看图、出错后重试（连点只发一次）
  const [viewing, setViewing] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const retryId = canAct && snapshot ? retryNoticeId(snapshot.items, running, snapshot.queue.length) : null
  const retry = useCallback(() => {
    if (!link || retrying) return
    setRetrying(true)
    setRetryError(null)
    link
      .call('engine:send', sessionId, { text: RETRY_MESSAGE, clientMessageId: crypto.randomUUID() })
      .catch((e: Error) => setRetryError(e.message))
      .finally(() => setRetrying(false))
  }, [link, retrying, sessionId])
  const actions: TurnActions = { sessionId, image, view: setViewing, retryId, retrying, retry }

  return (
    <Screen
      scroll={false}
      title={record?.title || '会话'}
      subtitle={
        <span className="flex items-center gap-1.5">
          <Dot
            tone={sessionState === 'waiting' ? 'danger' : sessionState === 'running' ? 'online' : 'muted'}
            pulse={sessionState === 'running'}
          />
          {sessionStateText[sessionState]}
          {project && <span className="truncate text-fg-faint">· {project}</span>}
        </span>
      }
      leading={leading}
      actions={
        running && (
          <button
            type="button"
            disabled={!canAct}
            aria-label="停止"
            onClick={() => void link?.call('engine:interrupt', sessionId).catch(() => undefined)}
            className="mr-2 flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-meta font-medium text-fg disabled:opacity-40"
          >
            <Square size={11} className="fill-danger text-danger" /> 停止
          </button>
        )
      }
      footer={
        // 宽屏：对话和输入框都在中间一栏，不铺满整个窗口
        <div className="mx-auto w-full max-w-3xl">
          {pending ? (
            <ApprovalCard key={pending.requestId} request={pending} canAct={canAct} onAnswer={answer} />
          ) : (
            <>
              {snapshot && (
                <QueuePanel link={link} sessionId={sessionId} snapshot={snapshot} canAct={canAct} onRecall={onRecall} />
              )}
              {composer}
            </>
          )}
        </div>
      }
    >
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-y-auto overscroll-contain">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-3 pb-6">
            {state !== 'ready' && state && (
              <Banner tone="warn" icon={<Spinner size={14} />}>
                {linkStateText[state]}
              </Banner>
            )}
            {error && <Banner tone="danger">{error}</Banner>}
            {retryError && <Banner tone="danger">{retryError}</Banner>}
            {!snapshot && !error && (
              <div className="flex items-center justify-center gap-2 py-16 text-meta text-fg-muted">
                <Spinner /> 正在加载…
              </div>
            )}
            {view.before && (
              <button
                type="button"
                onClick={() => void loadOlder()}
                className="self-center rounded-full bg-subtle px-3 py-1.5 text-meta text-fg-secondary"
              >
                加载更早的消息
              </button>
            )}
            {turns.map((turn, i) => (
              <TurnBlock
                key={turn.id}
                turn={turn}
                running={running && i === turns.length - 1}
                waiting={!!pending && i === turns.length - 1}
                truncated={view.truncated}
                onDetail={id => void detail(id)}
                actions={actions}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          aria-label="回到最新"
          onClick={toBottom}
          className={cn(
            'absolute right-4 bottom-3 flex size-10 items-center justify-center rounded-full border border-line bg-popover text-fg-secondary shadow-popover transition-all',
            atBottom ? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100',
          )}
        >
          <ArrowDown size={18} />
        </button>
      </div>
      {viewing && <ImageViewer src={viewing} onClose={() => setViewing(null)} />}
    </Screen>
  )
}
