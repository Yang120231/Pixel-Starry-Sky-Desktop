import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { ChevronRight, FileDiff, SquareArrowOutUpRight, Undo2 } from 'lucide-react'
import { Button, DiffStat, IconButton, cn, useComingSoon } from '@/ui'
import { DiffView } from '@/ui/code/DiffView'
import { changedFiles, type ChangedFiles } from '@/data'
import { openFile } from '@/features/files/store'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { isDemo, projects } from '@/data'
import { useState, type CSSProperties } from 'react'

/**
 * 改动文件卡片；data 不传时用演示数据。
 * 真实会话里没做好的按钮不显示（docs/ui/conversation-ux.md §2.1）：「撤销」只在演示模式出现，「审查」要传 onReview。
 * 点文件行在卡片里展开这一轮的 diff，行尾图标打开编辑器；没有 diff 的文件点行直接打开（docs/ui/changes-inline-diff.md）。
 */
export function ChangedFilesCard({
  className,
  data = changedFiles,
  target,
  onReview,
  style,
}: {
  className?: string
  style?: CSSProperties
  data?: ChangedFiles | null
  target?: WorkspaceRef
  onReview?: () => void
}) {
  useI18n()
  const comingSoon = useComingSoon()
  const [error, setError] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  if (!data) return null
  const review = onReview ?? (isDemo ? () => comingSoon(tr('session.ChangedFilesCard.review')) : null)
  return (
    <section className={cn('rounded-xl border border-line-card bg-surface shadow-sm', className)} style={style}>
      {/* 一行标题（docs/ui/conversation-concise.md §3 E） */}
      <div className="flex min-h-10 items-center gap-2 px-4 pt-1.5 pb-0.5">
        <FileDiff size={15} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 truncate text-list font-medium text-fg">
          {tr(
            data.files.length === 1 ? 'session.ChangedFilesCard.editedFile' : 'session.ChangedFilesCard.editedFiles',
            { n: data.files.length },
          )}
        </span>
        <DiffStat added={data.added} removed={data.removed} className="shrink-0 text-meta" />
        <span className="flex-1" />
        {isDemo && (
          <Button
            variant="ghost"
            icon={Undo2}
            className="h-7 px-2 text-meta"
            onClick={() => comingSoon(tr('session.ChangedFilesCard.undo'))}
          >
            {tr('session.ChangedFilesCard.undo')}
          </Button>
        )}
        {review && (
          <Button variant="outline" pill className="h-7 px-3 text-meta" onClick={review}>
            {tr('session.ChangedFilesCard.review')}
          </Button>
        )}
      </div>
      <ul className="px-2 pb-2">
        {data.files.map(f => {
          const path = f.dir + f.name
          const ref = target ?? (isDemo && projects[0] ? { projectId: projects[0].id } : null)
          const openInEditor = (): void => {
            if (ref) void openFile(ref, path, undefined, 1, f.newText).catch(e => setError(e.message))
          }
          const diffs = f.diffs ?? []
          const expanded = diffs.length > 0 && open.has(path)
          const toggle = (): void =>
            setOpen(current => {
              const next = new Set(current)
              if (!next.delete(path)) next.add(path)
              return next
            })
          return (
            <li key={path}>
              <div className="group/file flex h-[34px] items-center gap-1 rounded-md pr-1 pl-2 text-list hover:bg-hover">
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  aria-expanded={diffs.length ? expanded : undefined}
                  title={
                    diffs.length
                      ? tr(expanded ? 'session.ChangedFilesCard.hideChanges' : 'session.ChangedFilesCard.showChanges')
                      : tr('session.ChangedFilesCard.openFileInPixel')
                  }
                  disabled={!diffs.length && !ref}
                  onClick={diffs.length ? toggle : openInEditor}
                >
                  {diffs.length > 0 && (
                    <ChevronRight
                      size={14}
                      strokeWidth={1.5}
                      className={cn(
                        'shrink-0 text-fg-muted transition-transform duration-(--dur-fast)',
                        expanded && 'rotate-90',
                      )}
                    />
                  )}
                  <span className={cn('min-w-0 flex-1 truncate', !diffs.length && 'hover:underline')}>
                    <span className="text-fg-muted">{f.dir}</span>
                    <span className="text-fg">{f.name}</span>
                  </span>
                  <DiffStat added={f.added} removed={f.removed} className="shrink-0 text-meta" />
                </button>
                {diffs.length > 0 && ref && (
                  <IconButton
                    icon={SquareArrowOutUpRight}
                    label={tr('session.ChangedFilesCard.openInEditor')}
                    size={26}
                    iconSize={14}
                    onClick={openInEditor}
                    className={cn(
                      'opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100',
                      expanded && 'opacity-100',
                    )}
                  />
                )}
              </div>
              {expanded && (
                <div className="mx-2 mt-0.5 mb-1.5 max-h-72 overflow-auto rounded-lg border border-line-card bg-surface py-1.5">
                  {diffs.map((diff, i) => (
                    <DiffView
                      key={i}
                      diff={diff}
                      path={path}
                      className={i > 0 ? 'mt-1.5 border-t border-line-subtle pt-1.5' : undefined}
                    />
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="status" className="px-4 pb-3 text-meta text-danger">
          {translateMessage(error)}
        </p>
      )}
    </section>
  )
}
