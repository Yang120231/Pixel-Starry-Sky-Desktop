import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { FileDiff, Undo2 } from 'lucide-react'
import { Button, DiffStat, cn, useComingSoon } from '@/ui'
import { changedFiles, type ChangedFiles } from '@/data'
import { openFile } from '@/features/files/store'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { isDemo, projects } from '@/data'
import { useState } from 'react'

/** 改动文件卡片；data 不传时用演示数据 */
export function ChangedFilesCard({
  className,
  data = changedFiles,
  target,
}: {
  className?: string
  data?: ChangedFiles | null
  target?: WorkspaceRef
}) {
  useI18n()
  const comingSoon = useComingSoon()
  const [error, setError] = useState('')
  if (!data) return null
  return (
    <section className={cn('rounded-xl border border-line-card bg-surface shadow-sm', className)}>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-secondary">
          <FileDiff size={18} strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-prose leading-snug font-semibold text-fg">
            {tr(
              data.files.length === 1 ? 'session.ChangedFilesCard.editedFile' : 'session.ChangedFilesCard.editedFiles',
              { n: data.files.length },
            )}
          </div>
          <DiffStat added={data.added} removed={data.removed} className="text-meta" />
        </div>
        <Button variant="ghost" icon={Undo2} onClick={() => comingSoon(tr('session.ChangedFilesCard.undo'))}>
          {tr('session.ChangedFilesCard.undo')}{' '}
        </Button>
        <Button variant="outline" pill onClick={() => comingSoon(tr('session.ChangedFilesCard.review'))}>
          {tr('session.ChangedFilesCard.review')}{' '}
        </Button>
      </div>
      <ul className="px-2 pb-2">
        {data.files.map(f => (
          <li
            key={f.dir + f.name}
            className="flex h-[34px] items-center gap-3 rounded-md px-2 text-list hover:bg-hover"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left hover:underline"
              title={tr('session.ChangedFilesCard.openFileInPixel')}
              disabled={!target && !isDemo}
              onClick={() => {
                const ref = target ?? (isDemo && projects[0] ? { projectId: projects[0].id } : null)
                if (ref) void openFile(ref, f.dir + f.name, undefined, 1, f.newText).catch(e => setError(e.message))
              }}
            >
              <span className="text-fg-muted">{f.dir}</span>
              <span className="text-fg">{f.name}</span>
            </button>
            <DiffStat added={f.added} removed={f.removed} className="text-meta" />
          </li>
        ))}
      </ul>
      {error && (
        <p role="status" className="px-4 pb-3 text-meta text-danger">
          {translateMessage(error)}
        </p>
      )}
    </section>
  )
}
