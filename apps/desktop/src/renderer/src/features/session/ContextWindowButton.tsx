import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, RefreshCw, Scissors, X } from 'lucide-react'
import type { ContextDetail } from '@pixelsky/protocol'
import { ContextRing, cn } from '@/ui'
import { bridge, useSession } from '@/features/engine'
import { isDemo } from '@/data'
import { contextLabel, contextNumber, contextPercentage, contextSegments } from './contextData'
import { demo } from '@/data/demo'

export function ContextWindowButton({ sessionId }: { sessionId: string | null }) {
  useI18n()
  const snapshot = useSession(isDemo ? null : sessionId)
  const context = isDemo ? demo().context : snapshot?.context
  const percent = contextPercentage(context),
    segments = contextSegments(context)
  const [open, setOpen] = useState(false),
    [details, setDetails] = useState(false),
    [busy, setBusy] = useState<'inspect' | 'compact' | null>(null),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null)
  const canInspect =
    !isDemo &&
    !!sessionId &&
    !!snapshot?.flags.contextAvailable &&
    snapshot.state === 'idle' &&
    !snapshot.queue.length &&
    !busy
  const canCompact =
    !isDemo &&
    !!sessionId &&
    !!snapshot?.flags.compactAvailable &&
    snapshot.state === 'idle' &&
    !snapshot.queue.length &&
    !busy
  const diagnostic = context?.diagnostic
  const compactLimit =
    diagnostic && !context?.diagnosticStale
      ? diagnostic.window - (diagnostic.categories.find(c => c.kind === 'buffer')?.tokens ?? 0)
      : null
  const reason = isDemo
    ? tr('session.ContextWindowButton.message153')
    : !sessionId
      ? tr('session.ContextWindowButton.message154')
      : snapshot?.state !== 'idle' || !!snapshot?.queue.length
        ? tr('session.ContextWindowButton.message155')
        : tr('session.ContextWindowButton.message156')
  useEffect(() => {
    setOpen(false)
    setConfirm(false)
    setError('')
  }, [sessionId, snapshot?.record.model, snapshot?.record.platform?.groupId])
  const close = (): void => {
    setOpen(false)
    setConfirm(false)
    trigger.current?.focus()
  }
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return
    const position = (): void => {
      const r = trigger.current!.getBoundingClientRect(),
        p = popup.current!
      const bounds = p.getBoundingClientRect()
      p.style.left = `${Math.max(8, Math.min(r.right - bounds.width, innerWidth - bounds.width - 8))}px`
      p.style.top = `${Math.max(8, r.top - bounds.height - 8)}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(popup.current)
    popup.current.focus()
    window.addEventListener('resize', position)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (!popup.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) {
        setOpen(false)
        setConfirm(false)
      }
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [open])
  const inspect = async (): Promise<void> => {
    if (!canInspect || !sessionId) return
    setBusy('inspect')
    setError('')
    try {
      await bridge?.context(sessionId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const compact = async (): Promise<void> => {
    if (!canCompact || !sessionId) return
    setBusy('compact')
    setError('')
    try {
      await bridge?.compact(sessionId)
      setConfirm(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <span className="inline-flex shrink-0">
      <button
        ref={trigger}
        type="button"
        data-context-trigger
        aria-label={tr('session.ContextWindowButton.message157')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          context?.compacting
            ? tr('session.ContextWindowButton.message158')
            : percent !== null
              ? tr('session.ContextWindowButton.message159', {
                  p0: contextNumber(context?.used),
                  p1: contextNumber(context?.window),
                  p2: percent.toFixed(1),
                })
              : tr('session.ContextWindowButton.message160')
        }
        onClick={() => setOpen(v => !v)}
        className={cn(
          'press no-drag inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-meta hover:bg-hover',
          percent !== null && percent >= 80 ? 'text-warn' : 'text-fg-muted',
        )}
      >
        <ContextRing percent={Math.min(100, Math.max(0, percent ?? 0))} size={16} />
        <span className="tabular-nums">
          {context?.compacting
            ? tr('session.ContextWindowButton.message161')
            : percent === null
              ? tr('session.ContextWindowButton.message162')
              : `${Number(percent.toFixed(1))}%`}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            role="dialog"
            aria-label={tr('session.ContextWindowButton.message163')}
            tabIndex={-1}
            data-context-popover
            className="pop-in no-drag fixed z-50 max-h-[calc(100vh-16px)] w-[440px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-line-card bg-popover p-4 text-ui text-fg shadow-menu outline-none"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
              e.stopPropagation()
            }}
          >
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-ui font-medium">{tr('session.ContextWindowButton.message157')}</h2>
              <span className="text-ui text-fg-secondary tabular-nums">
                {context?.stale
                  ? tr('session.ContextWindowButton.message164')
                  : `${contextNumber(context?.used)} / ${contextNumber(context?.window)}${percent === null ? '' : `（${Number(percent.toFixed(1))}%）`}`}
              </span>
              <button
                type="button"
                aria-label={tr('session.ContextWindowButton.message165')}
                onClick={close}
                className="rounded-md p-1 text-fg-muted hover:bg-hover"
              >
                <X size={14} />
              </button>
            </div>
            <div
              role="progressbar"
              aria-label={tr('session.ContextWindowButton.message166')}
              aria-valuenow={percent === null ? undefined : Math.min(100, percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="my-3 flex h-1.5 w-full overflow-hidden rounded-full bg-subtle"
            >
              {segments.map((segment, i) => (
                <span
                  key={i}
                  title={`${segment.name}：${segment.tokens.toLocaleString('zh-CN')} Token`}
                  className={cn('h-full', segment.color)}
                  style={{ width: `${Math.min(100, Math.max(0, (segment.tokens / (context?.window || 1)) * 100))}%` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-fg-muted">
              <span>
                {context?.compacting
                  ? tr('session.ContextWindowButton.message167')
                  : context?.stale
                    ? tr('session.ContextWindowButton.message168')
                    : percent !== null && percent >= 80
                      ? tr('session.ContextWindowButton.message169')
                      : context?.used === null || !context
                        ? tr('session.ContextWindowButton.message170')
                        : !context.window
                          ? tr('session.ContextWindowButton.message171')
                          : tr('session.ContextWindowButton.message172', {
                              p0: contextNumber(Math.max(0, context.window - context.used)),
                            })}
              </span>
              <button
                type="button"
                disabled={!canCompact}
                title={!canCompact ? reason : tr('session.ContextWindowButton.message173')}
                onClick={() => setConfirm(v => !v)}
                className="inline-flex items-center gap-1 text-accent-fg hover:underline disabled:cursor-default disabled:text-fg-faint disabled:no-underline"
              >
                <Scissors size={13} />
                {tr('session.ContextWindowButton.message174')}
              </button>
            </div>
            {compactLimit !== null && (
              <p className="mt-2 text-label text-fg-muted">
                {tr('session.ContextWindowButton.message175')} {contextNumber(diagnostic!.window - compactLimit)}
                {tr('session.ContextWindowButton.message176')} {contextNumber(compactLimit)}
              </p>
            )}
            {confirm && (
              <div className="mt-3 rounded-lg bg-subtle p-3 text-meta">
                <p>{tr('session.ContextWindowButton.message177')}</p>
                <div className="mt-2 flex justify-end gap-3">
                  <button type="button" onClick={() => setConfirm(false)} className="text-fg-muted">
                    {tr('account.AccountMenu.message31')}
                  </button>
                  <button
                    type="button"
                    disabled={!canCompact}
                    onClick={() => void compact()}
                    className="text-accent-fg disabled:opacity-50"
                  >
                    {tr('session.ContextWindowButton.message178')}
                  </button>
                </div>
              </div>
            )}
            {error && (
              <p role="status" className="mt-2 text-meta text-danger">
                {translateMessage(error)}
              </p>
            )}
            <div className="mt-3 border-t border-line pt-2">
              <button
                type="button"
                aria-expanded={details}
                onClick={() => {
                  setDetails(v => !v)
                  if (!details && canInspect && (!diagnostic || context?.diagnosticStale)) void inspect()
                }}
                className="flex h-8 w-full items-center gap-1 text-left text-ui text-fg-secondary hover:text-fg"
              >
                <ChevronRight size={14} className={details ? 'rotate-90' : undefined} />
                {tr('session.ContextWindowButton.message179')}
              </button>
              {details && (
                <div className="mt-2">
                  <div className="mb-2 flex items-center gap-2 text-label text-fg-muted">
                    <span className="flex-1">
                      {diagnostic
                        ? tr('session.ContextWindowButton.message180', {
                            p0: context?.diagnosticStale ? '（待刷新）' : '',
                          })
                        : tr('session.ContextWindowButton.message182')}
                    </span>
                    <button
                      type="button"
                      disabled={!canInspect}
                      title={!canInspect ? reason : tr('session.ContextWindowButton.message183')}
                      onClick={() => void inspect()}
                      className="inline-flex items-center gap-1 text-accent-fg disabled:text-fg-faint"
                    >
                      <RefreshCw size={12} className={busy === 'inspect' ? 'animate-spin' : undefined} />
                      {busy === 'inspect'
                        ? tr('session.ContextWindowButton.message184')
                        : tr('session.ContextWindowButton.message185')}
                    </button>
                  </div>
                  {diagnostic ? (
                    <>
                      <div className="space-y-1">
                        {diagnostic.categories.map((c, i) => (
                          <NumberRow
                            key={i}
                            name={contextLabel(c.name)}
                            value={c.tokens}
                            percent={diagnostic.window > 0 ? (c.tokens / diagnostic.window) * 100 : null}
                          />
                        ))}
                      </div>
                      <DetailGroup title={tr('session.contextData.message142')} rows={diagnostic.tools} />
                      <DetailGroup title={tr('session.contextData.message143')} rows={diagnostic.memory} />
                      <DetailGroup title={tr('session.contextData.message145')} rows={diagnostic.agents} />
                      <DetailGroup title="Skills" rows={diagnostic.skills} />
                    </>
                  ) : (
                    <>
                      <NumberRow name={tr('session.contextData.message149')} value={context?.input ?? null} />
                      <NumberRow name={tr('session.contextData.message150')} value={context?.cacheRead ?? null} />
                      <NumberRow name={tr('session.contextData.message151')} value={context?.cacheWrite ?? null} />
                      <p className="mt-2 text-label text-fg-faint">{tr('session.ContextWindowButton.message186')}</p>
                    </>
                  )}
                  <div className="mt-3 border-t border-line pt-2">
                    <NumberRow name={tr('session.ContextWindowButton.message187')} value={context?.output ?? null} />
                  </div>
                  <p className="mt-2 text-label text-fg-faint">
                    {diagnostic
                      ? tr('session.ContextWindowButton.message188')
                      : tr('session.ContextWindowButton.message189')}
                  </p>
                </div>
              )}
            </div>
            <p className="mt-2 truncate text-label text-fg-faint" title={context?.model ?? ''}>
              {context?.model ?? tr('session.ContextWindowButton.message190')}
              {context?.observedAt
                ? tr('session.ContextWindowButton.message191', {
                    p0: new Date(context.observedAt).toLocaleTimeString('zh-CN'),
                  })
                : ''}
              {isDemo ? tr('session.ContextWindowButton.message192') : ''}
            </p>
          </div>,
          document.body,
        )}
    </span>
  )
}
function NumberRow({ name, value, percent }: { name: string; value: number | null; percent?: number | null }) {
  useI18n()
  return (
    <div className="flex items-center gap-3 py-1 text-meta">
      <span className="min-w-0 flex-1 truncate text-fg-secondary" title={name}>
        {name}
      </span>
      <span className="tabular-nums">{value === null ? '—' : value.toLocaleString('zh-CN')}</span>
      {percent !== undefined && (
        <span className="w-12 text-right text-fg-muted tabular-nums">
          {percent === null ? '—' : `${Number(percent.toFixed(1))}%`}
        </span>
      )}
    </div>
  )
}
function DetailGroup({ title, rows }: { title: string; rows: ContextDetail[] }) {
  useI18n()
  if (!rows.length) return null
  return (
    <details className="mt-2 rounded-md bg-subtle px-2 py-1">
      <summary className="cursor-pointer text-meta text-fg-secondary">
        {title}（{rows.length}）
      </summary>
      {rows.map((row, i) => (
        <NumberRow key={i} name={row.name} value={row.tokens} />
      ))}
    </details>
  )
}
