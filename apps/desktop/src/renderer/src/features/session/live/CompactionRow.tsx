// 压缩上下文（docs/ui/compaction.md）：对话流里的一条分隔线。
// 进行中：图标和进度条在动，计时每秒走；结束：「压缩前 → 压缩后」、减少的比例和用时。
// 在页面上看着它压完时，进度条从满格缩到压缩后的比例、数字从压缩前递减到压缩后；翻历史时直接显示结果
import { useEffect, useRef, useState } from 'react'
import { FoldVertical } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { cn } from '@/ui'
import { useTheme } from '@/features/appearance/ThemeProvider'
import { formatTokens } from '@/features/usage/format'
import { formatDuration } from './agentTrace'
import {
  compactionClock,
  compactionRatio,
  compactionSaved,
  easeOut,
  easeTokens,
  type CompactionItem,
} from './compaction'

const SHRINK_MS = 900

function useReducedMotion(): boolean {
  const { motion } = useTheme()
  return motion === 'off' || (motion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

/** 进行中每秒刷新 */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

/** 刚在页面上压完：0→1 的进度，驱动数字递减；其它情况直接是 1 */
function useShrink(item: CompactionItem, reduced: boolean): number {
  // 挂上时还在压缩：说明用户看着它压完。压缩后的大小可能晚一点才到（下一次请求补上），到了再播
  const watched = useRef(item.status === 'running')
  const [t, setT] = useState(0)
  const animate = watched.current && item.status === 'completed' && item.postTokens !== null && !reduced
  useEffect(() => {
    if (item.status === 'running') {
      watched.current = true
      return
    }
    if (!animate) return
    const start = performance.now()
    let frame = requestAnimationFrame(function step(time) {
      const next = Math.min(1, (time - start) / SHRINK_MS)
      setT(next)
      if (next < 1) frame = requestAnimationFrame(step)
      else watched.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [item.status, animate])
  return animate ? t : 1
}

export function CompactionRow({ item }: { item: CompactionItem }) {
  useI18n()
  const reduced = useReducedMotion()
  const running = item.status === 'running'
  const now = useClock(running)
  const progress = useShrink(item, reduced)
  const ratio = compactionRatio(item)
  const saved = compactionSaved(item)
  const pre = item.preTokens,
    post = item.postTokens
  const shownPost = pre !== null && post !== null ? easeTokens(pre, post, progress) : post

  const title = running
    ? tr('session.compaction.running')
    : item.status === 'completed'
      ? tr(item.trigger === 'auto' ? 'session.compaction.autoDone' : 'session.compaction.done')
      : item.status === 'interrupted'
        ? tr('session.compaction.interrupted')
        : tr('session.compaction.failed')
  const failed = item.status === 'failed'
  const time = running
    ? compactionClock(now - item.startedAt)
    : item.durationMs !== null
      ? tr('session.compaction.took', { time: formatDuration(item.durationMs) })
      : null
  const exact = [
    pre !== null ? tr('session.compaction.before', { n: pre.toLocaleString() }) : null,
    post !== null ? tr('session.compaction.after', { n: post.toLocaleString() }) : null,
  ]
    .filter(Boolean)
    .join('\n')

  const tone = running ? 'running' : failed ? 'failed' : item.status === 'interrupted' ? 'muted' : 'done'
  const meter = running || ratio !== null
  return (
    <div
      data-compaction={item.status}
      role={running ? 'status' : undefined}
      className="compaction-row my-2.5 flex flex-col items-center gap-1.5 text-meta select-none"
    >
      <div className="flex w-full items-center gap-3">
        <span className="h-px min-w-6 flex-1 bg-linear-to-r from-transparent to-line" />
        <div
          data-tone={tone}
          title={exact || undefined}
          className={cn(
            'compaction-pill inline-flex h-8 max-w-[88%] min-w-0 items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 shadow-sm',
            tone === 'running' && 'compaction-pill-running text-fg-secondary',
            tone === 'done' && 'border-line-subtle bg-surface text-fg-secondary',
            tone === 'failed' && 'border-warn/35 bg-warn/[0.06] text-warn',
            tone === 'muted' && 'border-line-subtle bg-surface text-fg-muted',
          )}
        >
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full',
              tone === 'running' && 'bg-accent text-accent-on',
              tone === 'done' && 'bg-accent-soft text-accent-fg',
              tone === 'failed' && 'bg-warn/15 text-warn',
              tone === 'muted' && 'bg-subtle text-fg-muted',
            )}
          >
            <FoldVertical size={13} strokeWidth={2} className={cn(running && 'compaction-icon')} />
          </span>
          <span className={cn('shrink-0 font-medium', running && 'compaction-text')}>{title}</span>
          {pre !== null && (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-label tabular-nums">
              <span className={shownPost !== null ? 'text-fg-faint' : 'text-fg-muted'}>{formatTokens(pre)}</span>
              {meter && (
                <span className="relative block h-1.5 w-14 overflow-hidden rounded-full bg-line">
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full',
                      running ? 'compaction-squeeze w-full' : 'bg-accent',
                    )}
                    style={
                      running || ratio === null
                        ? undefined
                        : { width: `${(1 - (1 - ratio) * easeOut(progress)) * 100}%` }
                    }
                  />
                </span>
              )}
              {shownPost !== null && <span className="font-semibold text-fg">{formatTokens(shownPost)}</span>}
            </span>
          )}
          {saved !== null && progress === 1 && (
            <span className="compaction-saved shrink-0 rounded-full bg-success/12 px-1.5 text-label font-medium text-success tabular-nums">
              −{saved}%
            </span>
          )}
          {time && (
            <>
              <span className="h-3 w-px shrink-0 bg-line" />
              <span className="shrink-0 text-fg-faint tabular-nums">{time}</span>
            </>
          )}
        </div>
        <span className="h-px min-w-6 flex-1 bg-linear-to-l from-transparent to-line" />
      </div>
      {failed && item.error && (
        <span className="max-w-[70%] truncate text-label text-fg-faint" title={item.error}>
          {translateMessage(item.error)}
        </span>
      )}
    </div>
  )
}
