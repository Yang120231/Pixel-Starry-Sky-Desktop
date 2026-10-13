import { useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleAlert, CirclePause, ShieldAlert, type LucideIcon } from 'lucide-react'
import { Button, cn, CountBadge } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage, type TranslationKey } from '@/i18n/core'
import { bridge, relativeTime, useEngineState } from '@/features/engine'
import { openSession } from '@/features/engine/store'
import { OPEN_SESSION_EVENT } from '@/features/engine/openRequests'
import { isDemo } from '@/data'
import { CARD, ToolError, useOperation, useRemember } from '../ToolsUi'
import { canAnswerInline, canResume, LANES, type InboxItem, type InboxLane } from './inboxModel'
import { dismissInbox, resolveDemoInbox, useInbox } from './useInbox'

const LANE: Record<InboxLane, { label: TranslationKey; icon: LucideIcon; tone: string }> = {
  waiting: { label: 'projectTools.inbox.lane.waiting', icon: ShieldAlert, tone: 'text-warn' },
  failed: { label: 'projectTools.inbox.lane.failed', icon: CircleAlert, tone: 'text-danger' },
  paused: { label: 'projectTools.inbox.lane.paused', icon: CirclePause, tone: 'text-fg-muted' },
}
/** 后台读取快照的上限：只为显示审批内容，不必全部打开 */
const MAX_PREFETCH = 20

const open = (sessionId: string) => window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId } }))

function reasonOf(item: InboxItem): string {
  if (item.lane === 'waiting') {
    const r = item.request
    return r?.command?.trim() || r?.questions?.[0]?.question || r?.title || tr('projectTools.inbox.waitingUnknown')
  }
  if (item.lane === 'failed') return item.error ? translateMessage(item.error) : tr('projectTools.inbox.failedUnknown')
  return tr('projectTools.inbox.pausedCount', { count: (item.queue?.queued ?? 0) + (item.queue?.failed ?? 0) })
}

/** 任务 › 待处理（docs/ui/tasks-inbox.md）：不依赖当前项目，列出当前机器上需要你处理的会话 */
export function TaskInbox() {
  useI18n()
  const items = useInbox()
  const [collapsed, setCollapsed] = useRemember('pixelsky.inbox.collapsed', false)
  const { busy, error, run } = useOperation()
  const snapshots = useEngineState(s => s.snapshots)
  const fetched = useRef(new Set<string>())
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 等你处理但还没打开过的会话：后台读一次快照，好显示审批内容
  useEffect(() => {
    if (isDemo) return
    // 不再等你处理的会话忘掉：快照可能已被释放，下次又等你处理时要再读一次
    const waiting = new Set(items.filter(item => item.lane === 'waiting').map(item => item.sessionId))
    for (const id of fetched.current) if (!waiting.has(id)) fetched.current.delete(id)
    for (const item of items) {
      if (
        item.lane !== 'waiting' ||
        snapshots[item.sessionId] ||
        fetched.current.has(item.sessionId) ||
        fetched.current.size >= MAX_PREFETCH
      )
        continue
      fetched.current.add(item.sessionId)
      void openSession(item.sessionId).catch(() => {})
    }
  }, [items, snapshots])

  const act = (item: InboxItem, fn: () => Promise<void>) =>
    run(async () => {
      if (isDemo) resolveDemoInbox(item.sessionId)
      else await fn()
    })
  const listId = 'task-inbox-list'
  return (
    <section data-task-inbox className={cn(CARD, 'flex flex-col gap-2')}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={listId}
        title={tr(collapsed ? 'projectTools.inbox.expand' : 'projectTools.inbox.collapse')}
        onClick={() => setCollapsed(!collapsed)}
        className="-m-1 flex items-center gap-2 rounded-md p-1 text-left hover:bg-hover"
      >
        <span className="text-ui font-medium text-fg">{tr('projectTools.inbox.title')}</span>
        {items.length > 0 && <CountBadge count={items.length} />}
        <span className="min-w-0 flex-1 truncate text-meta text-fg-faint">{tr('projectTools.inbox.hint')}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-fg-muted transition-transform', collapsed && '-rotate-90')}
        />
      </button>
      {!collapsed && (
        <div id={listId} className="flex flex-col gap-2">
          <ToolError error={error} />
          {items.length === 0 && (
            <p className="py-2 text-center text-meta text-fg-muted">{tr('projectTools.inbox.empty')}</p>
          )}
          {LANES.map(lane => {
            const rows = items.filter(i => i.lane === lane)
            if (!rows.length) return null
            const meta = LANE[lane]
            return (
              <div key={lane} className="flex flex-col gap-1.5">
                <h3 className={cn('flex items-center gap-1.5 text-meta font-medium', meta.tone)}>
                  <meta.icon size={13} />
                  {tr(meta.label)}
                </h3>
                {rows.map(item => {
                  const reason = reasonOf(item)
                  return (
                    <article
                      key={item.sessionId}
                      data-inbox-item={item.sessionId}
                      className="rounded-md border border-line-subtle px-2.5 py-2"
                    >
                      <div className="flex min-w-0 items-baseline gap-2">
                        <button
                          type="button"
                          onClick={() => open(item.sessionId)}
                          className="min-w-0 flex-1 truncate text-left text-list font-medium text-fg hover:underline"
                        >
                          {item.title}
                        </button>
                        <span className="shrink-0 text-meta text-fg-faint tabular-nums">
                          {relativeTime(item.at, now)}
                        </span>
                      </div>
                      <p
                        title={reason}
                        className={cn(
                          'mt-0.5 line-clamp-2 break-words text-meta',
                          item.lane === 'failed' ? 'text-danger' : 'text-fg-muted',
                        )}
                      >
                        {item.project && <span className="text-fg-faint">{item.project} · </span>}
                        {item.lane === 'waiting' && item.request?.command ? (
                          <code className="font-mono">{reason}</code>
                        ) : (
                          reason
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.lane === 'waiting' &&
                          (canAnswerInline(item.request) ? (
                            <>
                              <Button
                                variant="primary"
                                className="h-7 px-2.5 text-meta"
                                disabled={busy}
                                onClick={() =>
                                  void act(item, () =>
                                    bridge!.answer(item.sessionId, item.request!.requestId, { type: 'allow' }),
                                  )
                                }
                              >
                                {tr('projectTools.inbox.allow')}
                              </Button>
                              {item.request.canDeny !== false && (
                                <Button
                                  className="h-7 px-2.5 text-meta"
                                  disabled={busy}
                                  onClick={() =>
                                    void act(item, () =>
                                      bridge!.answer(item.sessionId, item.request!.requestId, { type: 'deny' }),
                                    )
                                  }
                                >
                                  {tr('projectTools.inbox.deny')}
                                </Button>
                              )}
                            </>
                          ) : (
                            <Button
                              variant="primary"
                              className="h-7 px-2.5 text-meta"
                              onClick={() => open(item.sessionId)}
                            >
                              {tr('projectTools.inbox.answer')}
                            </Button>
                          ))}
                        {canResume(item.queue) && (
                          <Button
                            className="h-7 px-2.5 text-meta"
                            disabled={busy}
                            onClick={() => void act(item, () => bridge!.resumeQueue(item.sessionId))}
                          >
                            {tr('projectTools.inbox.resume')}
                          </Button>
                        )}
                        {item.lane !== 'waiting' && (
                          <Button className="h-7 px-2.5 text-meta" onClick={() => open(item.sessionId)}>
                            {tr('projectTools.inbox.open')}
                          </Button>
                        )}
                        <Button variant="ghost" className="h-7 px-2.5 text-meta" onClick={() => dismissInbox(item)}>
                          {tr('projectTools.inbox.dismiss')}
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
