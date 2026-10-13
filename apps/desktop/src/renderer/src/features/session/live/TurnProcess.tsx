import { useI18n } from '@/i18n/I18nProvider'
import { tr, type TranslationKey } from '../../../i18n/core'
// 每轮的过程收成一行「执行」（docs/ui/conversation-concise.md §3）：点开看全部；运行中露出最近 2 条
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Layers } from 'lucide-react'
import type { Item } from '@pixelsky/protocol'
import { cn } from '@/ui'
import { StatusDot } from './StatusDot'
import { REQUEST_MS, useExpandAny } from '@/features/search/expand'
import { formatDuration } from './agentTrace'
import { summarize, type ProcessSummary } from './turnFold'
import { STEP_CLOCK_MS, WAIT_CLOCK_MS, clockText, currentStep, stepText, waitingFor } from './currentStep'
import { useSince } from './stepClock'
import { useMinimal } from '@/features/appearance/ThemeProvider'

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

/**
 * 运行中「执行」行写现在在干什么（docs/ui/conversation-concise.md §7），代替累计的概要：
 * 有在跑的一步就写这一步（超过 3 秒带用时，并行的写「等 N 项」）；两步之间写在等什么（超过 5 秒带已等的时间）；
 * 正在输出文字、等你批准时照旧写累计概要。结束后写最终概要
 */
function useActivity(items: Item[], running: boolean, live: boolean): string | null {
  const step = running ? currentStep(items) : null
  const last = items[items.length - 1]
  const writing = last?.kind === 'assistant' && last.status === 'running'
  const waiting = running && live && !step && !writing ? waitingFor(items) : null
  const key = step ? `step:${step.item.id}` : waiting ? `wait:${last?.id ?? ''}:${waiting}` : null
  const since = useSince(key, running)
  if (step) {
    const parts = [stepText(step.item)]
    if (step.more > 0) parts.push(tr('session.step.more', { n: step.more }))
    if (since >= STEP_CLOCK_MS) parts.push(clockText(since, formatDuration))
    return parts.join(' · ')
  }
  if (waiting) {
    const text = tr(`session.wait.${waiting}`)
    return since >= WAIT_CLOCK_MS ? `${text} · ${clockText(since, formatDuration)}` : text
  }
  return null
}

export function TurnProcess({
  items,
  running,
  live = running,
  durationMs,
  render,
}: {
  items: Item[]
  running: boolean
  /** 引擎正在干活（不是在等你批准 / 回答）：只有这时两步之间才写「正在看结果」这类等待 */
  live?: boolean
  durationMs: number | null
  /** 显示一组过程条目（LiveTranscript 的工具行分组、思考、待办、过渡话） */
  render: (items: Item[]) => ReactNode
}) {
  useI18n()
  const activity = useActivity(items, running, live)
  // 极简模式（docs/ui/minimal-mode.md §3、§4）：和 Factory 一样每一步都摊开，一条一行；点过就按点的来
  const minimal = useMinimal()
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? minimal
  // 对话内搜索的「展开」、全局搜索跳到里面的条目：执行块先展开，里面的条目自己再展开
  const ids = useMemo(() => items.map(i => i.id), [items])
  const requested = useExpandAny(ids)
  useEffect(() => {
    if (requested && Date.now() - requested < REQUEST_MS) setToggled(true)
  }, [requested])
  const summary = useMemo(() => summarize(items), [items])
  // 隐藏了内容的思考（只剩「思考了 N 秒」或什么都不显示）不算步数，也不占运行中露出的那几条
  const shown = useMemo(
    () => items.filter(i => !(i.kind === 'reasoning' && i.status !== 'running' && !i.text.trim())),
    [items],
  )
  const tail = running && !open ? shown.slice(-TAIL) : []
  // 收起时不在页面上的条目：对话内搜索算进「折叠中还有 N 处」
  const hidden = open ? [] : ids.slice(0, ids.length - tail.length)
  return (
    <div data-fold={open ? 'open' : 'closed'} data-fold-items={hidden.join(' ') || undefined} data-turn-process>
      <button
        type="button"
        aria-expanded={open}
        title={tr(open ? 'session.process.collapse' : 'session.process.expand')}
        onClick={() => setToggled(!open)}
        className="flex h-[30px] max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-list text-fg-muted hover:bg-hover hover:text-fg-secondary"
      >
        {running ? (
          <StatusDot status="running" className="mr-0.5" />
        ) : (
          <Layers size={15} strokeWidth={1.5} className="mr-0.5 shrink-0" />
        )}
        <span className="shrink-0 text-fg-secondary">
          {tr(running ? 'session.process.running' : 'session.process.title')}
        </span>
        <span aria-hidden className="shrink-0 text-fg-faint">
          ·
        </span>
        <span
          data-activity={activity ? '' : undefined}
          className={cn('min-w-0 truncate', activity && 'text-fg-secondary tabular-nums')}
          title={activity ?? undefined}
        >
          {activity ?? summaryText(summary, shown.length)}
        </span>
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
        <div data-process-rows className="mt-1 ml-[15px] flex flex-col gap-3 border-l border-line-subtle pl-3">
          {render(open ? items : tail)}
        </div>
      )}
    </div>
  )
}
