// 安装 / 更新引擎的进度（docs/ui/engine-update.md）：拿不到百分比，按以往用时模拟进度（ui/simulatedProgress.ts），
// 旁边写阶段、已用时间和最后一行输出；做完跳满格，失败停在原处变红
import type { EngineJob } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage, type TranslationKey } from '../../../i18n/core'
import { cn } from '@/ui'
import { useSimulatedProgress } from '@/ui/simulatedProgress'
import { useReducedMotion } from '@/features/appearance/ThemeProvider'
import { compactionClock } from '@/features/session/live/compaction'
import { expectedJobMs } from './engineUpdate'

const PHASE: Record<EngineJob['phase'], TranslationKey> = {
  prepare: 'engineJob.phase.prepare',
  download: 'engineJob.phase.download',
  install: 'engineJob.phase.install',
  verify: 'engineJob.phase.verify',
  done: 'engineJob.phase.done',
  failed: 'engineJob.phase.failed',
}

/** compact：列表那一行里的细条 + 阶段；否则详情页里带最后一行输出 */
export function JobProgress({ job, compact = false }: { job: EngineJob; compact?: boolean }) {
  useI18n()
  const reduced = useReducedMotion()
  const running = job.phase !== 'done' && job.phase !== 'failed'
  const sim = useSimulatedProgress(job.startedAt, expectedJobMs(job.engine, job.action), running, reduced)
  const value = job.phase === 'done' ? 1 : sim.value
  const failed = job.phase === 'failed'
  const label = tr(job.action === 'install' ? 'engineJob.installing' : 'engineJob.updating')
  return (
    <div className={cn(compact ? 'mt-1.5' : 'mt-3 rounded-lg border border-line px-3 py-2.5')}>
      <div className="flex items-center gap-2 text-meta">
        <span className={cn('min-w-0 truncate', failed ? 'text-danger' : 'text-fg-secondary')}>
          {tr(PHASE[job.phase])}
        </span>
        {running && sim.slow && <span className="shrink-0 truncate text-fg-faint">{tr('engineJob.slow')}</span>}
        <span className="ml-auto shrink-0 text-fg-faint tabular-nums">{compactionClock(sim.elapsedMs)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={tr(PHASE[job.phase])}
        className={cn('mt-1 overflow-hidden rounded-full bg-subtle', compact ? 'h-1' : 'h-1.5')}
      >
        <div
          className={cn(
            'h-full rounded-full',
            failed ? 'bg-danger' : 'bg-primary',
            !reduced && 'transition-[width] duration-200 ease-linear',
          )}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      {!compact && (job.error || job.line) && (
        <p
          className={cn('mt-1.5 truncate font-mono text-label', failed ? 'text-danger' : 'text-fg-muted')}
          title={job.error ? translateMessage(job.error) : (job.line ?? undefined)}
        >
          {job.error ? translateMessage(job.error) : job.line}
        </p>
      )}
    </div>
  )
}
