// 一次导入多个项目（docs/ui/multi-root-projects.md §2）：「从一个文件夹导入…」的勾选对话框，和加完之后的一句提示。
// 窗口级挂载一次；入口发事件（IMPORT_PROJECTS_EVENT、PROJECTS_ADDED_EVENT），这里接
import { useEffect, useState } from 'react'
import { Folder } from 'lucide-react'
import type { AddProjectsResult } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { cn, useToast } from '@/ui'
import { IMPORT_PROJECTS_EVENT, PROJECTS_ADDED_EVENT, addProjectPaths, importCandidates } from '@/features/engine/store'
import type { ImportCandidates } from '../../../../shared/types/workspace'
import { addedSummary, defaultPicked } from './projectImportModel'

const message = (e: unknown): string => translateMessage(e instanceof Error ? e.message : String(e))

export function ProjectImport() {
  useI18n()
  const toast = useToast()
  const [data, setData] = useState<ImportCandidates | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const open = (): void => {
      importCandidates().then(
        next => {
          if (!next) return
          setData(next)
          setPicked(new Set(defaultPicked(next.candidates)))
          setError(null)
        },
        e => toast(message(e), { duration: 4000 }),
      )
    }
    const added = (event: Event): void => {
      const text = addedSummary((event as CustomEvent<AddProjectsResult>).detail)
      if (text) toast(text, { duration: 4000 })
    }
    window.addEventListener(IMPORT_PROJECTS_EVENT, open)
    window.addEventListener(PROJECTS_ADDED_EVENT, added)
    return () => {
      window.removeEventListener(IMPORT_PROJECTS_EVENT, open)
      window.removeEventListener(PROJECTS_ADDED_EVENT, added)
    }
  }, [toast])

  if (!data) return null
  const choosable = data.candidates.filter(c => !c.added)
  const allPicked = choosable.length > 0 && choosable.every(c => picked.has(c.path))
  const toggle = (path: string): void =>
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // 按列表里的顺序加
      await addProjectPaths(data.candidates.filter(c => picked.has(c.path)).map(c => c.path))
      setData(null)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      title={tr('projectImport.title')}
      description={
        <div data-project-import>
          <p className="break-all text-meta text-fg-muted" title={data.parent}>
            {data.parent}
          </p>
          <p className="mt-1">{tr('projectImport.intro')}</p>
          {data.candidates.length === 0 ? (
            <p className="mt-3 text-meta text-fg-muted">{tr('projectImport.empty')}</p>
          ) : (
            <>
              <label className="mt-3 flex items-center gap-2 px-2 text-meta text-fg-muted">
                <input
                  type="checkbox"
                  checked={allPicked}
                  disabled={!choosable.length}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(choosable.map(c => c.path)))}
                />
                {tr('projectImport.selectAll')}
              </label>
              <ul className="mt-1 max-h-72 overflow-auto rounded-md border border-line p-1">
                {data.candidates.map(c => (
                  <li key={c.path}>
                    <label
                      title={c.path}
                      className={cn(
                        'flex items-center gap-2 rounded px-2 py-1.5 text-ui',
                        c.added ? 'text-fg-faint' : 'cursor-pointer text-fg hover:bg-hover',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={c.added || picked.has(c.path)}
                        disabled={c.added || busy}
                        onChange={() => toggle(c.path)}
                      />
                      <Folder size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {(c.added || c.project) && (
                        <span className="shrink-0 rounded border border-line px-1 text-label text-fg-muted">
                          {tr(c.added ? 'projectImport.alreadyAdded' : 'projectImport.looksLikeProject')}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
              {data.truncated && (
                <p className="mt-1 text-meta text-fg-muted">
                  {tr('projectImport.truncated', { n: data.candidates.length })}
                </p>
              )}
            </>
          )}
        </div>
      }
      confirmLabel={tr('projectImport.confirm', { n: picked.size })}
      cancelLabel={tr('projectImport.cancel')}
      busy={busy}
      error={error}
      confirmDisabled={picked.size === 0}
      onConfirm={() => void confirm()}
      onCancel={() => setData(null)}
    />
  )
}
