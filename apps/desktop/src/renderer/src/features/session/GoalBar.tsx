import { useState } from 'react'
import { Pause, Play, Target, X } from 'lucide-react'
import type { GoalAction, GoalStatus, SessionGoal } from '@pixelsky/protocol'
import { Button, IconButton, Spinner, cn } from '@/ui'
import { useEngineState } from '@/features/engine/store'
import { formatDuration, formatTokens } from '@/features/usage/format'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'

const STATUS_KEY = {
  active: 'goal.status.active',
  paused: 'goal.status.paused',
  blocked: 'goal.status.blocked',
  usageLimited: 'goal.status.usageLimited',
  budgetLimited: 'goal.status.budgetLimited',
  complete: 'goal.status.complete',
} as const satisfies Record<GoalStatus, string>

export const goalStatusText = (status: GoalStatus): string => tr(STATUS_KEY[status])

/** 状态点的颜色：进行中强调色，卡住 / 用完警告色，完成成功色，暂停灰 */
const DOT: Record<GoalStatus, string> = {
  active: 'bg-accent',
  paused: 'bg-fg-faint',
  blocked: 'bg-warn',
  usageLimited: 'bg-warn',
  budgetLimited: 'bg-warn',
  complete: 'bg-success',
}

const SHOW_KEY = {
  active: 'goal.native.showActive',
  paused: 'goal.native.showPaused',
  blocked: 'goal.native.showBlocked',
  usageLimited: 'goal.native.showUsageLimited',
  budgetLimited: 'goal.native.showBudgetLimited',
  complete: 'goal.native.showComplete',
} as const satisfies Record<GoalStatus, string>

/** 输入框里的 /goal 直接生效后的提示（和进程没在跑时引擎在对话里说的同一句） */
export function goalResultText(action: GoalAction, goal: SessionGoal | null): string {
  if (action.kind === 'set') return tr('goal.native.set', { p0: action.objective })
  if (action.kind === 'pause') return tr('goal.native.paused')
  if (action.kind === 'resume') return tr('goal.native.resumed')
  if (action.kind === 'clear') return tr('goal.native.cleared')
  return goal ? tr(SHOW_KEY[goal.status], { p0: goal.objective }) : tr('goal.native.none')
}

/** 已用 token（有预算时带上预算）· 用时 */
export function goalUsageText(goal: SessionGoal): string {
  const used = formatTokens(goal.tokensUsed)
  const tokens =
    goal.tokenBudget === null
      ? tr('goal.bar.tokens', { used })
      : tr('goal.bar.tokensBudget', { used, budget: formatTokens(goal.tokenBudget) })
  return goal.timeUsedSeconds > 0
    ? `${tokens} · ${tr('goal.bar.time', { time: formatDuration(goal.timeUsedSeconds * 1000) })}`
    : tokens
}

/**
 * 输入框上方的目标栏（Codex /goal，docs/ui/codex-goal.md §2）：会话有目标时显示目标、状态、用量，
 * 按钮马上生效（不排队）。onAction 返回 null 表示引擎进程不在了（目标也就跟着没了）
 */
export function GoalBar({
  sessionId,
  onAction,
}: {
  sessionId: string | null
  onAction: (action: GoalAction) => Promise<unknown>
}) {
  useI18n()
  const goal = useEngineState(s => (sessionId ? (s.snapshots[sessionId]?.goal ?? null) : null))
  const [busy, setBusy] = useState<GoalAction['kind'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!goal) return null
  const act = async (action: GoalAction): Promise<void> => {
    if (busy) return
    setBusy(action.kind)
    setError(null)
    try {
      await onAction(action)
    } catch (err) {
      setError(translateMessage((err as Error).message))
    } finally {
      setBusy(null)
    }
  }
  const status = goalStatusText(goal.status)
  const usage = goalUsageText(goal)
  const canResume = goal.status !== 'active' && goal.status !== 'complete'
  return (
    <section
      aria-label={tr('goal.bar.region')}
      className="@container/goal mb-2 flex flex-col gap-1 rounded-lg border border-line-card bg-surface px-3 py-1.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Target size={13} className="shrink-0 text-fg-muted" aria-hidden />
        <span className="shrink-0 text-meta text-fg-muted">{tr('goal.bar.label')}</span>
        <span className={cn('size-1.5 shrink-0 rounded-full', DOT[goal.status])} aria-hidden />
        <span
          className={cn(
            'shrink-0 text-meta',
            goal.status === 'blocked' || goal.status === 'usageLimited' || goal.status === 'budgetLimited'
              ? 'text-warn'
              : 'text-fg-muted',
          )}
        >
          {status}
        </span>
        {/* 窄的时候用量藏起来，悬停目标文字时一起看 */}
        <span className="min-w-0 flex-1 truncate text-list text-fg-secondary" title={`${goal.objective}\n${usage}`}>
          {goal.objective}
        </span>
        <span className="hidden shrink-0 text-label text-fg-faint tabular-nums @min-[480px]/goal:inline">{usage}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {busy && <Spinner size={11} />}
          {goal.status === 'active' && (
            <Button
              variant="ghost"
              icon={Pause}
              disabled={!!busy}
              title={tr('goal.bar.pauseHint')}
              className="h-6 px-2 text-meta"
              onClick={() => void act({ kind: 'pause' })}
            >
              {tr('goal.bar.pause')}
            </Button>
          )}
          {canResume && (
            <Button
              variant="ghost"
              icon={Play}
              disabled={!!busy}
              title={tr('goal.bar.resumeHint')}
              className="h-6 px-2 text-meta"
              onClick={() => void act({ kind: 'resume' })}
            >
              {tr('goal.bar.resume')}
            </Button>
          )}
          <IconButton
            icon={X}
            size={24}
            iconSize={12}
            label={tr('goal.bar.clear')}
            title={tr('goal.bar.clearHint')}
            disabled={!!busy}
            onClick={() => void act({ kind: 'clear' })}
          />
        </div>
      </div>
      {error && <p className="text-meta text-danger">{error}</p>}
    </section>
  )
}
