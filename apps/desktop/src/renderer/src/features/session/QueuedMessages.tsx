import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useState } from 'react'
import { ArrowDown, ArrowUp, CornerDownRight, FastForward, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { QueuedMessage } from '@pixelsky/protocol'
import { Button, IconButton, Spinner, cn } from '@/ui'
import { effortLabel, type ComposerController } from '@/features/engine'
import { ImageAttachments } from '@/features/session/attachments/ImageAttachments'
import { FileAttachments } from '@/features/session/attachments/FileAttachments'
import { isSendFailure, isStarting } from './queueView'
import { useProviders } from '@/features/account/providers'

const same = (a: QueuedMessage['settings'], b: ComposerController['execution']) =>
  !!b &&
  a.model === b.model &&
  a.effort === b.effort &&
  a.platform?.groupId === b.platform?.groupId &&
  a.platform?.account === b.platform?.account &&
  (a.provider?.id ?? null) === (b.provider?.id ?? null)

export function QueuedMessages({
  live,
  onRecall,
  onPrepareRecall,
}: {
  live: ComposerController
  onRecall: (text: string) => void
  onPrepareRecall?: (message: QueuedMessage) => Promise<(() => Promise<void>) | void>
}) {
  useI18n()
  const providers = useProviders().providers
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 正在执行的、以及空闲时直接发送正在启动的消息都显示在对话里，不算排队
  const items = live.queue.filter(q => q.status !== 'running' && !isStarting(q, live.queuePaused))
  if (!items.length) return null
  const action = async (id: string, fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(id)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const visible = expanded ? items : items.slice(0, 3)
  const held = items.some(q => q.held)
  const paused = live.queuePaused || held
  const onlyFailures = items.every(isSendFailure)
  return (
    <section
      className="mb-2 flex max-h-64 flex-col gap-1.5 overflow-y-auto"
      aria-label={tr('session.QueuedMessages.messageQueue')}
    >
      <div className="flex items-center gap-2 px-1 text-meta text-fg-muted">
        {paused && !onlyFailures ? <Pause size={12} /> : <CornerDownRight size={12} />}
        <span>
          {onlyFailures
            ? tr('session.queue.sendFailed')
            : paused
              ? tr('session.QueuedMessages.queuePaused')
              : tr('session.QueuedMessages.messageQueue')}{' '}
          · {items.length}
        </span>
        {paused && !onlyFailures && live.state === 'idle' && (
          <span className="min-w-0 truncate text-fg-faint">{tr('session.QueuedMessages.heldHint')}</span>
        )}
        <span className="flex-1" />
        {paused && (
          <Button
            variant="ghost"
            icon={Play}
            disabled={!!busy}
            className="h-6 px-2 text-meta"
            onClick={() => void action('resume', live.resumeQueue)}
          >
            {tr('session.QueuedMessages.resumeQueue')}
          </Button>
        )}
        {items.length > 3 && (
          <button type="button" className="rounded-md px-2 py-1 hover:bg-hover" onClick={() => setExpanded(v => !v)}>
            {expanded ? tr('session.ModelSourceMenu.collapse') : tr('session.QueuedMessages.expandAll')}
          </button>
        )}
      </div>
      {visible.map(q => {
        const pending = q.status === 'dispatching' || q.status === 'delivering'
        const canSteer =
          q.status === 'queued' && live.steerAvailable && live.state === 'running' && same(q.settings, live.execution)
        const steerReason = !live.steerAvailable
          ? tr('session.QueuedMessages.steeringHasNotBeen')
          : live.state !== 'running'
            ? tr('session.QueuedMessages.noTaskCanAccept')
            : !same(q.settings, live.execution)
              ? tr('session.QueuedMessages.settingsDifferFromCurrent')
              : tr('session.QueuedMessages.sendAdditionalInstructionsTo')
        const label = isSendFailure(q)
          ? tr('session.queue.sendFailed')
          : q.status === 'failed'
            ? tr('session.QueuedMessages.executionFailed')
            : q.status === 'uncertain'
              ? tr('session.QueuedMessages.deliveryNeedsVerification')
              : q.status === 'delivering'
                ? tr('session.QueuedMessages.waitingForAdoption')
                : q.status === 'dispatching'
                  ? tr('session.QueuedMessages.starting')
                  : q.held
                    ? tr('session.QueuedMessages.held')
                    : tr('session.live.agentTrace.queued')
        return (
          <div key={q.id} data-queue-id={q.id} className="rounded-lg border border-line-card bg-surface px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {pending || busy === q.id ? (
                <Spinner size={11} />
              ) : (
                <span className={cn('size-1.5 rounded-full', q.error ? 'bg-warn' : 'bg-fg-faint')} />
              )}
              <span className={cn('shrink-0 text-meta', q.error ? 'text-warn' : 'text-fg-muted')}>{label}</span>
              <span className="min-w-20 flex-1 truncate text-list text-fg-secondary" title={q.text}>
                {q.text}
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                {q.status === 'queued' && (
                  <>
                    <IconButton
                      icon={ArrowUp}
                      size={24}
                      iconSize={12}
                      label={tr('session.QueuedMessages.moveMessageUp')}
                      disabled={!!busy || live.queue.indexOf(q) === 0}
                      onClick={() => void action(q.id, () => live.moveQueued(q.id, live.queue.indexOf(q) - 1))}
                    />
                    <IconButton
                      icon={ArrowDown}
                      size={24}
                      iconSize={12}
                      label={tr('session.QueuedMessages.moveMessageDown')}
                      disabled={!!busy || live.queue.indexOf(q) === live.queue.length - 1}
                      onClick={() => void action(q.id, () => live.moveQueued(q.id, live.queue.indexOf(q) + 1))}
                    />
                    <span title={steerReason}>
                      <Button
                        variant="ghost"
                        icon={CornerDownRight}
                        className="h-6 px-1.5 text-meta"
                        disabled={!!busy || !canSteer}
                        onClick={() => void action(q.id, () => live.steerQueued(q.id))}
                      >
                        {tr('session.QueuedMessages.steer')}
                      </Button>
                    </span>
                  </>
                )}
                {!pending && (
                  <>
                    <Button
                      variant="ghost"
                      icon={q.error ? RotateCcw : FastForward}
                      className="h-6 px-1.5 text-meta"
                      disabled={!!busy}
                      title={
                        q.status === 'uncertain'
                          ? tr('session.QueuedMessages.runAgainAfterChecking')
                          : tr('session.QueuedMessages.interruptCurrentTaskAnd')
                      }
                      onClick={() => void action(q.id, () => live.runQueuedNow(q.id))}
                    >
                      {q.error ? tr('session.ModelSourceMenu.retry') : tr('session.QueuedMessages.runNext')}
                    </Button>
                    <Button
                      variant="ghost"
                      icon={X}
                      className="h-6 px-1.5 text-meta"
                      disabled={!!busy}
                      onClick={() =>
                        void action(q.id, async () => {
                          const rollback = await onPrepareRecall?.(q)
                          try {
                            onRecall(await live.cancelQueued(q.id))
                          } catch (error) {
                            await rollback?.()
                            throw error
                          }
                        })
                      }
                    >
                      {tr('session.QueuedMessages.withdraw')}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div
              className="mt-0.5 pl-3.5 text-label text-fg-faint"
              title={tr('session.QueuedMessages.modelEffortAndCredit')}
            >
              {q.settings.model ?? tr('session.QueuedMessages.engineDefaultModel')} · {effortLabel(q.settings.effort)} ·{' '}
              {q.settings.platform
                ? tr('session.QueuedMessages.platformRoute', { p0: q.settings.platform.groupId })
                : q.settings.provider
                  ? tr('customApi.queued', {
                      p0: providers.find(p => p.id === q.settings.provider?.id)?.name ?? q.settings.provider.id,
                    })
                  : tr('session.QueuedMessages.ownCredits')}
            </div>
            {/* 原因只显示第一行：完整说明和原文在对话里的错误卡片上（docs/ui/conversation-ux-2.md §2.1） */}
            {q.error && (
              <p className="mt-1 truncate text-meta text-warn" title={translateMessage(q.error)}>
                {translateMessage(q.error.split('\n')[0])}
              </p>
            )}
            {!!q.attachments?.length && (
              <div className="mt-2">
                <ImageAttachments images={q.attachments} />
              </div>
            )}
            {!!q.files?.length && (
              <div className="mt-2">
                <FileAttachments files={q.files} />
              </div>
            )}
            {(q.text.length > 60 || q.text.includes('\n')) && (
              <details className="mt-1 pl-3.5 text-meta text-fg-muted">
                <summary className="cursor-pointer text-label hover:text-fg">
                  {tr('session.QueuedMessages.viewFullMessage')}
                </summary>
                <p className="mt-1 whitespace-pre-wrap break-words">{q.text}</p>
              </details>
            )}
          </div>
        )
      })}
      {error && (
        <p role="alert" className="px-1 text-meta whitespace-pre-wrap text-danger">
          {translateMessage(error)}
        </p>
      )}
    </section>
  )
}
