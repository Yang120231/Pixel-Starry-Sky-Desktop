import { useEffect, useState } from 'react'
import { ChevronRight, Folder, FileText } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { isDemo } from '@/data'
import { openFile, type OpenFile } from '@/features/files/store'
import { ActionMenu } from '@/ui/ActionMenu'
import type { FileEntry } from '../../../../shared/types/workspace'
import { demo } from '@/data/demo'
import { extraFolder, folderLabel, splitExtra } from '@/features/files/extraFolders'

export function FileBreadcrumbs({ tab }: { tab: OpenFile }) {
  const { t, text } = useI18n()
  const [menu, setMenu] = useState<{ path: string; x: number; y: number; trigger: HTMLElement } | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!menu) return
    let gone = false
    setLoading(true)
    setError('')
    setEntries([])
    const result = isDemo
      ? Promise.resolve(demo().files.directory(menu.path))
      : window.pixelsky!.files.list(tab.ref, menu.path)
    void result
      .then(
        list => {
          if (!gone) setEntries(list.entries)
        },
        e => {
          if (!gone) setError(e.message)
        },
      )
      .finally(() => {
        if (!gone) setLoading(false)
      })
    return () => {
      gone = true
    }
  }, [menu?.path, tab.id])
  // 附加文件夹里的文件（docs/ui/multi-root-projects.md §3.4）：第一节写文件夹名，路径都在「::N」下面
  const extra = splitExtra(tab.path)
  const folder = extra.index === null ? undefined : extraFolder(tab.ref, extra.index)
  const parts = extra.rest.split('/')
  const under = (rel: string): string => (extra.prefix ? (rel ? `${extra.prefix}/${rel}` : extra.prefix) : rel)
  const first = folder ? folderLabel(folder) : extra.prefix || tab.project || text('文件')
  return (
    <nav
      aria-label={t('workspace.breadcrumb')}
      className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-meta [scrollbar-width:none]"
    >
      {[first, ...parts].map((name, i) => (
        <span key={i} className="flex shrink-0 items-center">
          {i > 0 && <ChevronRight size={12} className="mx-0.5 text-fg-faint" />}
          <button
            type="button"
            title={i ? parts.slice(0, i).join('/') : (folder?.path ?? tab.root)}
            className="flex max-w-72 items-center gap-1 rounded px-1 py-1 text-fg-secondary hover:bg-hover"
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({
                path: under(i === parts.length ? parts.slice(0, -1).join('/') : parts.slice(0, i).join('/')),
                x: r.left,
                y: r.bottom,
                trigger: e.currentTarget,
              })
            }}
          >
            {i === 0 ? <Folder size={13} /> : i === parts.length ? <FileText size={13} /> : null}
            <span className="truncate">{name}</span>
          </button>
        </span>
      ))}
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={t('workspace.breadcrumb')}
          onClose={() => setMenu(null)}
          actions={[
            ...(menu.path && menu.path !== extra.prefix
              ? [{ label: '… /', run: () => setMenu({ ...menu, path: menu.path.split('/').slice(0, -1).join('/') }) }]
              : []),
            ...entries.map(entry => ({
              label: entry.name + (entry.kind === 'directory' ? '/' : ''),
              run: () => {
                if (entry.kind === 'directory') setMenu({ ...menu, path: entry.path })
                else void openFile(tab.ref, entry.path).catch(e => setError(e.message))
              },
            })),
            ...(loading || error || !entries.length
              ? [
                  {
                    label: error || t(loading ? 'workspace.loading' : 'workspace.noFiles'),
                    disabled: true,
                    run: () => {},
                  },
                ]
              : []),
          ]}
        />
      )}
    </nav>
  )
}
