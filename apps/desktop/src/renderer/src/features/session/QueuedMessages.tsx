import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useLayoutEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FastForward,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import type { QueuedMessage } from '@pixelsky/protocol'
import { Button, IconButton, Spinner, cn } from '@/ui'
import { effortLabel, type ComposerController, type QueueController } from '@/features/engine'
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

/** 对话区比这还矮时，队列默认收起成一行，先让输入框露出来 */
const SHORT_VIEW_PX = 420
/** 队列列表最高占对话区高度的三成，不低于 120px、不高于 256px */
export const queueListMaxHeight = (viewHeight: number): number =>
  Math.round(Math.max(120, Math.min(256, viewHeight * 0.3)))

export function QueuedMessages({
  live,
  onRecall,
  onPrepareRecall,
}: {
  live: QueueController
  onRecall: (text: string) => void
  onPrepareRecall?: (message: QueuedMessage) => Promise<(() => Promise<void>) | void>
}) {
  useI18n()
  const providers = useProviders().providers
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 按所在对话区的高度定列表最高多高、要不要先收起（窗格很矮时不和上面的内容叠在一起）
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [viewHeight, setViewHeight] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const view = root?.closest<HTMLElement>('.conversation-view')
    if (!view) return
    const measure = (): void => setViewHeight(view.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(view)
    return () => ro.disconnect()
  }, [root])
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
  // 模型 · 强度 · 线路：大家都一样时只在标题行写一次，否则写在各自那一行
  const settingsOf = (q: QueuedMessage): string =>
    `${q.settings.model ?? tr('session.QueuedMessages.engineDefaultModel')} · ${effortLabel(q.settings.effort)} · ${
      q.settings.platform
        ? tr('session.QueuedMessages.platformRoute', { p0: q.settings.platform.groupId })
        : q.settings.provider
          ? tr('customApi.queued', {
              p0: providers.find(p => p.id === q.settings.provider?.id)?.name ?? q.settings.provider.id,
            })
          : tr('session.QueuedMessages.ownCredits')
    }`
  const common = items.every(q => settingsOf(q) === settingsOf(items[0])) ? settingsOf(items[0]) : null
  const short = viewHeight !== null && viewHeight < SHORT_VIEW_PX
  const collapsed = short && !open
  const title = (
    <>
      {onlyFailures
        ? tr('session.queue.sendFailed')
        : paused
          ? tr('session.QueuedMessages.queuePaused')
          : tr('session.QueuedMessages.messageQueue')}{' '}
      · {items.length}
    </>
  )
  return (
    <section
      ref={setRoot}
      className="@container/queue mb-2 flex flex-col gap-1.5"
      aria-label={tr('session.QueuedMessages.messageQueue')}
    >
      <div className="flex shrink-0 items-center gap-2 px-1 text-meta text-fg-muted">
        {paused && !onlyFailures ? <Pause size={12} /> : <CornerDownRight size={12} />}
        {short ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setOpen(v => !v)}
            className="inline-flex shrink-0 items-center gap-1 rounded hover:text-fg"
          >
            {title}
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <span className="shrink-0">{title}</span>
        )}
        {common && (
          <span className="min-w-0 truncate text-fg-faint" title={tr('session.QueuedMessages.modelEffortAndCredit')}>
            · {common}
          </span>
        )}
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
        {!collapsed && items.length > 3 && (
          <button type="button" className="rounded-md px-2 py-1 hover:bg-hover" onClick={() => setExpanded(v => !v)}>
            {expanded ? tr('session.ModelSourceMenu.collapse') : tr('session.QueuedMessages.expandAll')}
          </button>
        )}
      </div>
      {!collapsed && (
        // 一个框里按行列出、细线分隔；框本身滚动，滚动时被切开的那行上面始终有框的边
        <div
          style={viewHeight === null ? undefined : { maxHeight: queueListMaxHeight(viewHeight) }}
          className="flex max-h-64 min-h-0 flex-col divide-y divide-line-card overflow-y-auto rounded-lg border border-line-card bg-surface"
        >
          {visible.map(q => {
            const pending = q.status === 'dispatching' || q.status === 'delivering'
            const canSteer =
              q.status === 'queued' &&
              live.steerAvailable &&
              live.state === 'running' &&
              same(q.settings, live.execution)
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
              <div key={q.id} data-queue-id={q.id} className="shrink-0 px-3 py-1.5 transition-colors hover:bg-hover/40">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {pending || busy === q.id ? (
                    <Spinner size={11} />
                  ) : (
                    <span className={cn('size-1.5 rounded-full', q.error ? 'bg-warn' : 'bg-fg-faint')} />
                  )}
                  {/* 全是发送失败时标题行已经写了，每行不再重复 */}
                  {!onlyFailures && (
                    <span className={cn('shrink-0 text-meta', q.error ? 'text-warn' : 'text-fg-muted')}>{label}</span>
                  )}
                  <span className="min-w-20 flex-1 truncate text-list text-fg-secondary" title={q.text}>
                    {q.text}
                  </span>
                  {/* 各条设置不一样时：宽的时候放在按钮左边排成一列，窄的时候放到错误原因后面 */}
                  {!common && (
                    <span
                      className="hidden shrink-0 text-label text-fg-faint tabular-nums @min-[600px]/queue:inline"
                      title={tr('session.QueuedMessages.modelEffortAndCredit')}
                    >
                      {settingsOf(q)}
                    </span>
                  )}
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
                {/* 原因只显示第一行：完整说明和原文在对话里的错误卡片上（docs/ui/conversation-ux-2.md §2.1）；
                    窄的时候设置跟在后面 */}
                {(q.error || !common) && (
                  <p className={cn('truncate pl-3.5 text-meta', !q.error && '@min-[600px]/queue:hidden')}>
                    {q.error && (
                      <span className="text-warn" title={translateMessage(q.error)}>
                        {translateMessage(q.error.split('\n')[0])}
                      </span>
                    )}
                    {q.error && !common && <span className="text-fg-faint @min-[600px]/queue:hidden"> · </span>}
                    {!common && (
                      <span
                        className="text-label text-fg-faint @min-[600px]/queue:hidden"
                        title={tr('session.QueuedMessages.modelEffortAndCredit')}
                      >
                        {settingsOf(q)}
                      </span>
                    )}
                  </p>
                )}
                {!!q.attachments?.length && (
                  <div className="mt-1.5 pl-3.5">
                    <ImageAttachments images={q.attachments} compact />
                  </div>
                )}
                {!!q.files?.length && (
                  <div className="mt-1.5 pl-3.5">
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
        </div>
      )}
      {error && (
        <p role="alert" className="px-1 text-meta whitespace-pre-wrap text-danger">
          {translateMessage(error)}
        </p>
      )}
    </section>
  )
}
