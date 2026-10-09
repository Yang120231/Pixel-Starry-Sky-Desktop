import { useEffect, useState } from 'react'
import { ChevronRight, Folder, FileText } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { isDemo } from '@/mock/data'
import { demoDirectory } from '@/mock/files'
import { openFile, type OpenFile } from '@/files/store'
import { ActionMenu } from '@/components/ui/ActionMenu'
import type { FileEntry } from '../../../preload/workspace'

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
    const result = isDemo ? Promise.resolve(demoDirectory(menu.path)) : window.pixelsky!.files.list(tab.ref, menu.path)
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
  const parts = tab.path.split('/')
  return (
    <nav
      aria-label={t('workspace.breadcrumb')}
      className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-meta [scrollbar-width:none]"
    >
      {[tab.project || text('文件'), ...parts].map((name, i) => (
        <span key={i} className="flex shrink-0 items-center">
          {i > 0 && <ChevronRight size={12} className="mx-0.5 text-fg-faint" />}
          <button
            type="button"
            title={i ? parts.slice(0, i).join('/') : tab.root}
            className="flex max-w-72 items-center gap-1 rounded px-1 py-1 text-fg-secondary hover:bg-hover"
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({
                path: i === parts.length ? parts.slice(0, -1).join('/') : parts.slice(0, i).join('/'),
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
            ...(menu.path
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
