import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleCheck, CircleX, TriangleAlert, Wrench } from 'lucide-react'
import { Button, Spinner, cn } from '@/ui'
import { checkProblems, type CheckItem, type CheckRun } from '../../../../shared/types/checks'

const RULE_KEY = {
  todo: 'checks.rule.todo',
  placeholder: 'checks.rule.placeholder',
  link: 'checks.rule.link',
} as const

function ItemChip({ item }: { item: CheckItem }) {
  useI18n()
  if (item.kind === 'command') {
    const ok = item.status === 'pass'
    const Icon = ok ? CircleCheck : CircleX
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1', ok ? 'text-success' : 'text-danger')}>
        <Icon size={13} strokeWidth={1.75} className="shrink-0" />
        <span className="truncate font-mono">{item.label}</span>
        {item.status === 'timeout' && <span>{tr('checks.timeout')}</span>}
      </span>
    )
  }
  if (item.status === 'skipped') return null
  if (item.status === 'pass')
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <CircleCheck size={13} strokeWidth={1.75} />
        {tr('checks.text')}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-warn">
      <TriangleAlert size={13} strokeWidth={1.75} />
      {tr('checks.findings', { count: item.findings.length })}
    </span>
  )
}

/**
 * 产出检查的一行（docs/ui/channels-collab-v2.md §8）：「✓ check ✗ test ⚠ 2 处要看」，点开看输出和发现；
 * 有问题且给了 onFix 时带「让它修」
 */
export function CheckSummary({
  run,
  onFix,
  className,
}: {
  run: CheckRun
  onFix?: () => Promise<void> | void
  className?: string
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (run.status === 'running')
    return (
      <div data-check-summary="running" className={cn('flex items-center gap-1.5 text-meta text-fg-muted', className)}>
        <Spinner size={11} />
        {tr('checks.running')}
      </div>
    )
  const { failed, findings } = checkProblems(run)
  const problems = failed.length > 0 || findings.length > 0
  const shown = run.items.filter(i => !(i.kind === 'text' && i.status === 'skipped'))
  const fix = async () => {
    if (!onFix) return
    setBusy(true)
    try {
      await onFix()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-check-summary={problems ? 'problems' : 'pass'} className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          className="inline-flex shrink-0 items-center gap-0.5 rounded text-fg-muted hover:text-fg"
        >
          {open ? <ChevronDown size={13} strokeWidth={1.5} /> : <ChevronRight size={13} strokeWidth={1.5} />}
          {tr('checks.title')}
        </button>
        {shown.length === 0 ? (
          <span className="text-fg-faint">{tr('checks.nothing')}</span>
        ) : (
          shown.map((item, i) => <ItemChip key={i} item={item} />)
        )}
        {problems && onFix && (
          <Button className="ml-auto h-6 px-2 text-meta" icon={Wrench} disabled={busy} onClick={() => void fix()}>
            {tr('checks.fix')}
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 rounded-md border border-line-card bg-subtle p-2 text-meta">
          {run.items.map((item, i) =>
            item.kind === 'command' ? (
              <div key={i} className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-fg">{item.command}</span>
                  <span className="shrink-0 text-fg-faint tabular-nums">
                    {tr(`checks.status.${item.status}`)} · {(item.ms / 1000).toFixed(1)}s
                  </span>
                </div>
                {item.status !== 'pass' && item.output && (
                  <pre className="selectable max-h-48 overflow-auto rounded bg-surface p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-fg-body [scrollbar-width:thin]">
                    {item.output}
                  </pre>
                )}
              </div>
            ) : item.status === 'skipped' ? (
              <span key={i} className="text-fg-faint">
                {tr('checks.textSkipped', { reason: item.note ?? '' })}
              </span>
            ) : item.findings.length === 0 ? (
              <span key={i} className="text-fg-faint">
                {tr('checks.textClean')}
              </span>
            ) : (
              <ul key={i} className="flex flex-col gap-0.5">
                {item.findings.map((f, j) => (
                  <li key={j} className="flex min-w-0 gap-2">
                    <span className="shrink-0 text-warn">{tr(RULE_KEY[f.rule])}</span>
                    <span className="shrink-0 font-mono text-fg-muted">
                      {f.file}:{f.line}
                    </span>
                    <span className="min-w-0 truncate text-fg-body" title={f.text}>
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>
            ),
          )}
        </div>
      )}
    </div>
  )
}
