// 开分支 / 合并回主会话（docs/ui/branch-merge.md §4、§5）：弹窗宿主、分支会话的横条、「分支从这里开始」、
// 输入框上方「下一条消息会带上合并摘要」、上级会话里的「分支合并」卡片
import { useState } from 'react'
import { FileText, GitBranch, GitMerge, MessageSquare, X } from 'lucide-react'
import type { NoticeBranchMerge, PendingMerge, SessionRecord } from '@pixelsky/protocol'
import { tr, translateMessage } from '@/i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { cn, DiffStat, IconButton } from '@/ui'
import { bridge } from '@/features/engine'
import { useEngineState } from '@/features/engine/store'
import { paneActions } from '@/features/panes/store'
import { BranchDialog } from './BranchDialog'
import { MergeDialog } from './MergeDialog'
import { mergeLabel, openMergeDialog, parentIsBranch, sessionBusy, useBranchDialog } from './store'

const BAR =
  'pop-in mb-2 flex min-h-9 items-center gap-2 rounded-lg border border-line-card bg-surface px-3 py-1 text-meta text-fg-secondary'

export function BranchDialogHost() {
  const state = useBranchDialog()
  if (!state) return null
  return state.kind === 'branch' ? (
    <BranchDialog key={`b:${state.sessionId}:${state.itemId}`} {...state} />
  ) : (
    <MergeDialog key={`m:${state.sessionId}`} sessionId={state.sessionId} />
  )
}

/** 分支会话顶部的横条：从哪开出来、代码在哪个副本；右边「合并回主会话」 */
export function BranchBanner({ record }: { record: SessionRecord }) {
  useI18n()
  const b = record.branch!
  const parentId = record.forkedFrom?.sessionId ?? null
  const parent = useEngineState(s =>
    parentId ? (s.snapshots[parentId]?.record ?? s.sessions.find(x => x.record.id === parentId)?.record ?? null) : null,
  )
  // 跟着会话状态重新算「在跑」：横条上的合并按钮跑着时不能点
  const busy = useEngineState(() => sessionBusy(record.id))
  const title = parent?.title ?? record.forkedFrom?.title ?? ''
  const up = tr(parentIsBranch(record) ? 'branch.up.parent' : 'branch.up.main')
  const text = b.copyRemoved
    ? tr('branch.banner.removed', { title })
    : b.copyId
      ? tr('branch.banner.copy', { title, branch: b.gitBranch ?? '', up })
      : tr('branch.banner.shared', { title })
  return (
    <div
      data-branch-banner
      className={cn(
        'flex shrink-0 items-center gap-2.5 border-b border-line-subtle px-5 py-2 text-meta text-fg-secondary',
        b.copyRemoved ? 'bg-subtle' : 'bg-accent-soft/60',
      )}
    >
      {b.copyRemoved ? (
        <GitMerge size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
      ) : (
        <GitBranch size={14} strokeWidth={1.75} className="shrink-0 text-accent-fg" />
      )}
      <span className="min-w-0 flex-1 truncate" title={text}>
        {parent ? (
          <button
            type="button"
            onClick={() => paneActions.open(parent.id)}
            className="press rounded text-left hover:text-fg hover:underline"
          >
            {text}
          </button>
        ) : (
          text
        )}
        {!parent && <span className="ml-2 text-fg-faint">{tr('branch.banner.parentGone')}</span>}
        {b.mergedAt && !b.copyRemoved && <span className="ml-2 text-fg-faint">· {tr('branch.banner.merged')}</span>}
      </span>
      {parent && !b.copyRemoved && (
        <button
          type="button"
          data-branch-merge
          disabled={busy}
          title={busy ? tr('merge.runningSelf') : undefined}
          onClick={() => openMergeDialog(record.id)}
          className="press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-meta text-fg hover:bg-hover disabled:opacity-50"
        >
          <GitMerge size={13} strokeWidth={1.75} />
          {tr(mergeLabel(record, 'banner'))}
        </button>
      )}
    </div>
  )
}

/** 对话里「分支从这里开始」：带过来的部分和分支自己的内容分开 */
export function BranchStartDivider() {
  useI18n()
  return (
    <div
      data-branch-start
      className="conversation-message my-1 flex items-center gap-2 text-meta whitespace-nowrap text-fg-muted before:h-px before:flex-1 before:bg-line-subtle after:h-px after:flex-1 after:bg-line-subtle"
    >
      {tr('branch.divider')}
    </div>
  )
}

/** 副本删了：输入框上方说一声只能回看 */
export function BranchReadOnlyBar() {
  useI18n()
  return (
    <div className={BAR} data-branch-readonly role="status">
      <GitMerge size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate">{tr('branch.readonly')}</span>
    </div>
  )
}

/** 输入框上方：下一条消息会带上合并摘要，× 这次不带 */
export function PendingMergeBar({ sessionId, pending }: { sessionId: string; pending: PendingMerge }) {
  useI18n()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className={BAR} data-pending-merge role="status">
      <GitMerge size={13} strokeWidth={1.75} className="shrink-0 text-accent-fg" />
      <span className="min-w-0 flex-1 truncate" title={pending.summary}>
        {error ? <span className="text-danger">{error}</span> : tr('merge.pending', { title: pending.title })}
      </span>
      <IconButton
        icon={X}
        label={tr('merge.pendingDrop')}
        size={24}
        iconSize={12}
        onClick={() =>
          void bridge?.dropPendingMerge(sessionId).catch(e => setError(translateMessage((e as Error).message)))
        }
      />
    </div>
  )
}

/** 摘要文字：以「·」开头的行是列表，其余是小标题 */
function SummaryText({ text }: { text: string }) {
  const blocks: { head?: string; items: string[] }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^[·•\-*]/.test(line)) {
      if (!blocks.length) blocks.push({ items: [] })
      blocks.at(-1)!.items.push(line.replace(/^[·•\-*]\s*/, ''))
    } else blocks.push({ head: line, items: [] })
  }
  return (
    <div className="flex flex-col gap-1">
      {blocks.map((b, i) => (
        <div key={i}>
          {b.head && <div className="font-semibold text-fg">{b.head}</div>}
          {b.items.length > 0 && (
            <ul className="list-disc pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

/** 上级会话里的「分支合并」卡片 */
export function MergeCard({ merge }: { merge: NoticeBranchMerge }) {
  useI18n()
  const [showFiles, setShowFiles] = useState(false)
  const added = merge.files.reduce((n, f) => n + (f.additions ?? 0), 0)
  const removed = merge.files.reduce((n, f) => n + (f.deletions ?? 0), 0)
  const head =
    merge.code === 'committed'
      ? merge.commitMessage
      : merge.code === 'applied'
        ? tr('merge.card.applied')
        : merge.code === 'skipped'
          ? tr('merge.card.skipped')
          : tr('merge.card.none')
  return (
    <div
      data-merge-card={merge.sessionId}
      className="my-2 overflow-hidden rounded-lg border border-l-[3px] border-line border-l-accent bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-line-subtle px-3.5 py-2.5 text-meta text-fg-secondary">
        <GitMerge size={15} strokeWidth={1.75} className="shrink-0 text-accent-fg" />
        <span className="min-w-0 truncate text-ui font-semibold text-fg">
          {tr('merge.card.title', { title: merge.title })}
        </span>
        <span className="flex-1" />
        <span className={cn('max-w-[45%] truncate', merge.code === 'committed' && 'font-mono')} title={head ?? ''}>
          {head}
        </span>
      </div>
      <div className="px-3.5 py-2.5 text-meta leading-relaxed text-fg-body">
        {merge.summary ? (
          <SummaryText text={merge.summary} />
        ) : (
          <p className="text-fg-muted">{tr('merge.card.noSummary')}</p>
        )}
        {(merge.files.length > 0 || merge.gitBranch) && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-fg-muted">
            {merge.files.length > 0 && (
              <>
                <DiffStat added={added} removed={removed} />
                <span>· {tr('merge.card.files', { n: merge.files.length })}</span>
              </>
            )}
            {merge.gitBranch && (
              <span>
                {merge.files.length > 0 && '· '}
                {merge.copyRemoved
                  ? tr('merge.card.copyRemoved')
                  : tr('merge.card.copyKept', { branch: merge.gitBranch })}
              </span>
            )}
          </p>
        )}
        {showFiles && (
          <div className="mt-1.5 border-t border-dashed border-line pt-1">
            {merge.files.map(f => (
              <div key={f.path} className="flex h-6 items-center gap-2">
                <FileText size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-fg-secondary">{f.path}</span>
                {f.additions !== null && <DiffStat added={f.additions} removed={f.deletions ?? 0} />}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1.5 px-3.5 pb-2.5">
        <button
          type="button"
          onClick={() => paneActions.open(merge.sessionId)}
          className="press inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-meta text-fg hover:bg-hover"
        >
          <MessageSquare size={13} strokeWidth={1.75} />
          {tr('merge.card.open')}
        </button>
        {merge.files.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFiles(v => !v)}
            className="press inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
          >
            <FileText size={13} strokeWidth={1.75} />
            {tr(showFiles ? 'merge.card.hideFiles' : 'merge.card.showFiles')}
          </button>
        )}
      </div>
    </div>
  )
}
