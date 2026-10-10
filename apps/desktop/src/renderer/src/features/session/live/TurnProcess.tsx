import { useI18n } from '@/i18n/I18nProvider'
import { tr, type TranslationKey } from '../../../i18n/core'
// 每轮的过程收成一行「执行」（docs/ui/conversation-concise.md §3）：点开看全部；运行中露出最近 2 条
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Layers } from 'lucide-react'
import type { Item } from '@pixelsky/protocol'
import { Spinner, cn } from '@/ui'
import { REQUEST_MS, useExpandAny } from '@/features/search/expand'
import { formatDuration } from './agentTrace'
import { summarize, type ProcessSummary } from './turnFold'

/** 运行中收起时露出的最近几条 */
const TAIL = 2

const PARTS: readonly (keyof Omit<ProcessSummary, 'failed'>)[] = [
  'commands',
  'edits',
  'reads',
  'searches',
  'web',
  'mcp',
  'agents',
  'other',
]

function summaryText(s: ProcessSummary, steps: number): string {
  const parts = PARTS.filter(k => s[k] > 0).map(k =>
    tr(`session.process.${k}${s[k] === 1 ? 'One' : ''}` as TranslationKey, { n: s[k] }),
  )
  return parts.length ? parts.join(tr('session.process.joiner')) : tr('session.process.steps', { n: steps })
}

export function TurnProcess({
  items,
  running,
  durationMs,
  render,
}: {
  items: Item[]
  running: boolean
  durationMs: number | null
  /** 显示一组过程条目（LiveTranscript 的工具行分组、思考、待办、过渡话） */
  render: (items: Item[]) => ReactNode
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  // 对话内搜索的「展开」、全局搜索跳到里面的条目：执行块先展开，里面的条目自己再展开
  const ids = useMemo(() => items.map(i => i.id), [items])
  const requested = useExpandAny(ids)
  useEffect(() => {
    if (requested && Date.now() - requested < REQUEST_MS) setOpen(true)
  }, [requested])
  const summary = useMemo(() => summarize(items), [items])
  const tail = running && !open ? items.slice(-TAIL) : []
  // 收起时不在页面上的条目：对话内搜索算进「折叠中还有 N 处」
  const hidden = open ? [] : ids.slice(0, ids.length - tail.length)
  return (
    <div data-fold={open ? 'open' : 'closed'} data-fold-items={hidden.join(' ') || undefined} data-turn-process>
      <button
        type="button"
        aria-expanded={open}
        title={tr(open ? 'session.process.collapse' : 'session.process.expand')}
        onClick={() => setOpen(v => !v)}
        className="flex h-[30px] max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-list text-fg-muted hover:bg-hover hover:text-fg-secondary"
      >
        {running ? <Spinner size={13} /> : <Layers size={15} strokeWidth={1.5} className="mr-0.5 shrink-0" />}
        <span className="shrink-0 text-fg-secondary">
          {tr(running ? 'session.process.running' : 'session.process.title')}
        </span>
        <span aria-hidden className="shrink-0 text-fg-faint">
          ·
        </span>
        <span className="min-w-0 truncate">{summaryText(summary, items.length)}</span>
        {summary.failed > 0 && (
          <span className="shrink-0 text-danger">
            <span aria-hidden className="mr-1.5 text-fg-faint">
              ·
            </span>
            {tr('session.process.failed', { n: summary.failed })}
          </span>
        )}
        {!running && durationMs !== null && (
          <span className="shrink-0 text-fg-faint tabular-nums">
            <span aria-hidden className="mr-1.5">
              ·
            </span>
            {formatDuration(durationMs)}
          </span>
        )}
        <ChevronRight
          size={15}
          strokeWidth={1.5}
          className={cn('shrink-0 transition-transform duration-(--dur-fast)', open && 'rotate-90')}
        />
      </button>
      {(open || tail.length > 0) && (
        <div className="mt-1 ml-[15px] flex flex-col gap-3 border-l border-line-subtle pl-3">
          {render(open ? items : tail)}
        </div>
      )}
    </div>
  )
}
