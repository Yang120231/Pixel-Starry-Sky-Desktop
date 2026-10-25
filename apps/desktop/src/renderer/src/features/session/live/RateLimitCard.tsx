import { useEffect, useState } from 'react'
import { Clock, RotateCw, TriangleAlert } from 'lucide-react'
import type { EngineId, QueuedMessage } from '@pixelsky/protocol'
import { translateMessage, tr } from '@/i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { Button } from '@/ui'
import { isDemo } from '@/data'
import { bridge } from '@/features/engine'
import { demoLimitAction } from '@/features/engine/demoQueue'
import { useSettings } from '@/features/settings/SettingsProvider'
import { openAccountsPage } from '@/features/model-channels/accountsStore'
import { clockText, resetClock } from '../quota/quotaModel'
import { countdownText, limitItem, limitPhase, limitProgress, limitTries } from './limitModel'

/**
 * 限流 / 额度用完后等到点自动继续的卡片（docs/ui/rate-limit-resume.md）：原因、恢复时间、倒计时、「恢复后自动继续」、
 * 「现在就试」「取消等待」；连续 3 次到点继续后仍被限流转成「已停止」，给「手动重试」。样子照 RetryStatus。
 * 计时在主进程（engine host/queue.ts limitWait），这里只按 reconnect.at 每秒刷新；
 * 勾选框 = 队列有没有暂停（取消勾选 → pauseReconnect，勾回去 → resumeQueue），重启后恢复出来的也是暂停，所以不会自己发
 */
export function RateLimitCard({
  sessionId,
  queue,
  paused,
  engine,
}: {
  sessionId: string
  queue: QueuedMessage[] | undefined
  paused: boolean
  engine: EngineId | undefined
}) {
  useI18n()
  const item = limitItem(queue)
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const itemId = item?.id
  const at = item?.reconnect?.at
  useEffect(() => {
    setBusy(false)
    setError(null)
  }, [sessionId, itemId])
  useEffect(() => {
    setNow(Date.now())
    if (at === undefined) return
    const tick = (): void => setNow(Date.now())
    const timer = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [at])
  const limit = item?.limit
  if (!item || !item.reconnect || !limit) return null
  const phase = limitPhase(item, paused, now)
  const remaining = item.reconnect.at - now
  const act = async (real: () => Promise<unknown>, demo: 'pause' | 'resume' | 'now' | 'cancel'): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (isDemo) demoLimitAction(sessionId, demo)
      else if (bridge) await real()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const tryNow = (): Promise<void> => act(() => bridge!.runQueuedNow(sessionId, item.id), 'now')
  const cancel = (): Promise<void> => act(() => bridge!.interrupt(sessionId), 'cancel')
  const title = tr(
    limit.kind === 'rate'
      ? 'session.limit.title.rate'
      : limit.window === 'five_hour'
        ? 'session.limit.title.fiveHour'
        : limit.window === 'seven_day'
          ? 'session.limit.title.week'
          : 'session.limit.title.quota',
  )

  if (phase === 'stopped')
    return (
      <div
        role="alert"
        data-limit-card="stopped"
        aria-label={tr('session.limit.stopped.title')}
        className="mb-2 rounded-lg border border-danger/30 bg-popover px-3 py-2.5"
      >
        <div className="flex items-center gap-2 font-semibold text-fg">
          <TriangleAlert size={14} strokeWidth={1.5} className="shrink-0 text-danger" />
          {tr('session.limit.stopped.title')}
          <span className="ml-auto rounded-full bg-subtle px-2 text-label font-normal text-danger">
            {tr('session.limit.stopped.pill', { p0: limitTries(item) })}
          </span>
        </div>
        <p className="mt-0.5 pl-[22px] text-meta text-fg-muted">
          {title} · {tr('session.limit.stopped.sub', { p0: limitTries(item) })}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 pl-[22px] font-mono text-label text-fg-muted">
          {limit.tries.map(t => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <i className="size-1.5 rounded-full bg-danger" />
              {tr('session.limit.stopped.try', { p0: clockText(t) })}
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2 pl-[22px]">
          <Button
            variant="primary"
            icon={RotateCw}
            className="h-7 px-2.5 text-meta"
            disabled={busy}
            data-limit-retry
            onClick={() => void tryNow()}
          >
            {tr('session.limit.retry')}
          </Button>
          {(engine === 'claude' || engine === 'codex') && <SwitchAccountButton engine={engine} />}
          <Button variant="ghost" className="h-7 px-2.5 text-meta" disabled={busy} onClick={() => void cancel()}>
            {tr('session.limit.close')}
          </Button>
        </div>
        {error && <p className="mt-1 pl-[22px] text-meta text-danger">{translateMessage(error)}</p>}
      </div>
    )

  const connecting = phase === 'connecting'
  const resetsAt = limit.resetsAt
  const sub =
    resetsAt === null
      ? tr('session.limit.sub.backoff', { p0: clockText(item.reconnect.at) })
      : resetsAt > now
        ? tr('session.limit.sub.reset', { p0: resetClock(resetsAt, now) })
        : tr('session.limit.sub.resetPassed', { p0: resetClock(resetsAt, now) })
  return (
    <div
      role="status"
      data-limit-card={phase}
      aria-label={tr('session.limit.label')}
      className="mb-2 rounded-lg border border-line-card bg-popover px-3 py-2.5"
    >
      <div className="flex items-center gap-2 font-semibold text-fg">
        <Clock size={14} strokeWidth={1.5} className="shrink-0 text-active" />
        {title}
        <span className="ml-auto rounded-full bg-subtle px-2 text-label font-normal text-warn">
          {tr(paused ? 'session.limit.pill.paused' : 'session.limit.pill.waiting')}
        </span>
      </div>
      <p className="mt-0.5 pl-[22px] text-meta text-fg-muted">{sub}</p>
      {connecting ? (
        <p className="mt-2 pl-[22px] text-meta text-fg-secondary">{tr('session.limit.connecting')}</p>
      ) : (
        remaining > 0 && (
          <>
            <div className="mt-2.5 flex items-baseline gap-2.5 pl-[22px]">
              <b data-limit-countdown className="font-mono text-[22px] leading-none font-semibold tabular-nums text-fg">
                {countdownText(remaining)}
              </b>
              <span className="text-meta text-fg-muted">
                {tr(resetsAt === null ? 'session.limit.untilTry' : 'session.limit.untilResume')}
              </span>
            </div>
            <div className="mt-2 ml-[22px] h-[3px] overflow-hidden rounded-full bg-selected">
              <i
                className="block h-full rounded-full bg-active transition-[width] duration-1000 ease-linear"
                style={{ width: `${limitProgress(item, now)}%` }}
              />
            </div>
          </>
        )
      )}
      <label className="mt-2.5 flex items-center gap-2 pl-[22px] text-meta text-fg-secondary">
        <input
          type="checkbox"
          data-limit-auto
          checked={!paused}
          disabled={busy}
          onChange={e =>
            void (e.target.checked
              ? act(() => bridge!.resumeQueue(sessionId), 'resume')
              : act(() => bridge!.pauseReconnect(sessionId), 'pause'))
          }
        />
        {tr('session.limit.auto')}
        <span className="text-fg-faint">{tr(paused ? 'session.limit.autoOffHint' : 'session.limit.autoHint')}</span>
      </label>
      <div className="mt-2.5 flex gap-2 pl-[22px]">
        <Button
          variant="subtle"
          icon={RotateCw}
          className="h-7 px-2.5 text-meta"
          disabled={busy || item.status === 'dispatching'}
          data-limit-now
          onClick={() => void tryNow()}
        >
          {tr('session.limit.tryNow')}
        </Button>
        <Button
          variant="ghost"
          className="h-7 px-2.5 text-meta"
          disabled={busy}
          data-limit-cancel
          onClick={() => void cancel()}
        >
          {tr('session.limit.cancel')}
        </Button>
      </div>
      {error && <p className="mt-1 pl-[22px] text-meta text-danger">{translateMessage(error)}</p>}
    </div>
  )
}

/** 「换账号」：打开设置 › 模型 › 对应引擎的账号页 */
function SwitchAccountButton({ engine }: { engine: 'claude' | 'codex' }) {
  const settings = useSettings()
  return (
    <Button
      variant="ghost"
      className="h-7 px-2.5 text-meta"
      onClick={() => {
        openAccountsPage(engine === 'claude' ? 'claude' : 'chatgpt')
        settings.openSettings('models')
      }}
    >
      {tr('session.limit.switchAccount')}
    </Button>
  )
}
