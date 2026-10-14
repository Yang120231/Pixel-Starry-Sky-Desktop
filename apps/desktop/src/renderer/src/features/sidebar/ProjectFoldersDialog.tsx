// 项目的附加文件夹（docs/ui/multi-root-projects.md §3.4）：侧栏项目右键「项目文件夹…」。
// 主文件夹固定在第一行；附加文件夹可以加（选文件夹窗口里可多选）、移除，点「保存」整组写回，只对之后新建的对话生效
import { useState } from 'react'
import { Folder, FolderInput, FolderPlus, X } from 'lucide-react'
import type { ProjectFolder } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { pickFolders, setProjectFolders } from '@/features/engine/store'

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() || path
const pathKey = (path: string): string => path.replace(/[\\/]+$/, '').toLowerCase()

export function ProjectFoldersDialog({
  project,
  onClose,
}: {
  project: { id: string; name: string; path: string; folders?: readonly ProjectFolder[] }
  onClose: () => void
}) {
  useI18n()
  const [folders, setFolders] = useState<ProjectFolder[]>(() => [...(project.folders ?? [])])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async (): Promise<void> => {
    setError(null)
    try {
      const picked = await pickFolders()
      if (!picked) return
      setFolders(prev => {
        const seen = new Set([pathKey(project.path), ...prev.map(f => pathKey(f.path))])
        const next = [...prev]
        for (const path of picked)
          if (!seen.has(pathKey(path))) {
            seen.add(pathKey(path))
            next.push({ path })
          }
        return next
      })
    } catch (e) {
      setError(translateMessage((e as Error).message))
    }
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await setProjectFolders(project.id, folders)
      onClose()
    } catch (e) {
      setError(translateMessage((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  const row = 'flex items-center gap-2 rounded px-2 py-1.5 text-ui'
  return (
    <ConfirmDialog
      title={tr('projectFolders.title', { name: project.name })}
      description={
        <div data-project-folders>
          <p>{tr('projectFolders.intro')}</p>
          <ul className="mt-3 rounded-md border border-line p-1">
            <li className={row} title={project.path}>
              <Folder size={14} strokeWidth={1.5} className="shrink-0 text-accent-fg" />
              <span className="min-w-0 flex-1 truncate text-fg">{folderName(project.path)}</span>
              <span className="shrink-0 rounded border border-line px-1 text-label text-fg-muted">
                {tr('projectFolders.main')}
              </span>
            </li>
            {folders.map(folder => (
              <li key={folder.path} className={row} title={folder.path}>
                <FolderInput size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-fg">{folder.name || folderName(folder.path)}</span>
                <span className="min-w-0 max-w-[45%] shrink truncate text-label text-fg-faint">{folder.path}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={tr('projectFolders.remove', { name: folder.name || folderName(folder.path) })}
                  title={tr('projectFolders.remove', { name: folder.name || folderName(folder.path) })}
                  onClick={() => setFolders(prev => prev.filter(f => f !== folder))}
                  className="press inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </li>
            ))}
            {!folders.length && <li className="px-2 py-1.5 text-meta text-fg-faint">{tr('projectFolders.none')}</li>}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => void add()}
            className="press mt-2 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-ui hover:bg-hover disabled:opacity-50"
          >
            <FolderPlus size={14} strokeWidth={1.5} />
            {tr('projectFolders.add')}
          </button>
        </div>
      }
      confirmLabel={tr('projectFolders.save')}
      cancelLabel={tr('projectFolders.cancel')}
      busy={busy}
      error={error}
      onConfirm={() => void save()}
      onCancel={onClose}
    />
  )
}
