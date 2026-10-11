// 会话页：按轮显示对话（向上加载更早的）、审批 / 提问卡片、停止、回到最新；输入框由 App 传进来（features 之间不互相导入）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, Square } from 'lucide-react'
import type { ApprovalDecision } from '@pixelsky/protocol'
import type { Pairing } from '@/connection'
import { useDesktop, useSession } from '@/data/hooks'
import { groupTurns } from '@/data/turns'
import { linkStateText, sessionStateText } from '@/i18n/zh'
import { Banner, Dot, Screen, Spinner, cn } from '@/ui'
import { ApprovalCard } from './ApprovalCard'
import { TurnBlock } from './ItemView'

export function SessionScreen({
  pairing,
  sessionId,
  onBack,
  composer,
}: {
  pairing: Pairing
  sessionId: string
  onBack(): void
  composer: ReactNode
}) {
  const { link, state, sessions, projects } = useDesktop(pairing.deviceId)
  const { view, error, loadOlder, detail } = useSession(pairing.deviceId, sessionId)
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

  return (
    <Screen
      scroll={false}
      title={record?.title || '任务'}
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
      onBack={onBack}
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
        pending ? (
          <ApprovalCard key={pending.requestId} request={pending} canAct={canAct} onAnswer={answer} />
        ) : (
          composer
        )
      }
    >
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-6 px-4 pt-3 pb-6">
            {state !== 'ready' && state && (
              <Banner tone="warn" icon={<Spinner size={14} />}>
                {linkStateText[state]}
              </Banner>
            )}
            {error && <Banner tone="danger">{error}</Banner>}
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
    </Screen>
  )
}
