import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, GitBranch, Plus } from 'lucide-react'
import { cn } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import type { GitBranch as Branch } from '../../../../../shared/types/project-tools'

/** 分支菜单（docs/ui/git-panel.md §2.6）：搜索、本地 / 远程两组、被副本占用的置灰、输入新名字时可以新建 */
export function BranchMenu({
  branches,
  loading,
  onSwitch,
  onCreate,
  onClose,
}: {
  branches: Branch[]
  loading: boolean
  onSwitch: (branch: Branch) => void
  onCreate: (name: string) => void
  onClose: () => void
}) {
  useI18n()
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])
  const q = query.trim()
  const shown = useMemo(() => branches.filter(b => b.name.toLowerCase().includes(q.toLowerCase())), [branches, q])
  const exact = branches.some(b => !b.remote && b.name === q)
  const groups: Array<[string, Branch[]]> = [
    [tr('git.branch.local'), shown.filter(b => !b.remote)],
    [tr('git.branch.remote'), shown.filter(b => b.remote)],
  ]
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={tr('git.branch.menu')}
      className="pop-in no-drag absolute top-full left-0 z-40 mt-1 flex max-h-80 w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-line-card bg-popover shadow-menu"
    >
      <div className="shrink-0 border-b border-line-subtle p-2">
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tr('git.branch.search')}
          aria-label={tr('git.branch.search')}
          onKeyDown={e => {
            if (e.key === 'Enter' && q && !exact) {
              e.preventDefault()
              onCreate(q)
            }
          }}
          className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-list text-fg outline-none focus-visible:border-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {q && !exact && (
          <button
            type="button"
            onClick={() => onCreate(q)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-list text-accent-fg hover:bg-hover"
          >
            <Plus size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{tr('git.branch.create', { name: q })}</span>
          </button>
        )}
        {loading && <p className="px-2 py-2 text-meta text-fg-muted">{tr('projectTools.loading')}</p>}
        {!loading && !shown.length && !q && (
          <p className="px-2 py-2 text-meta text-fg-muted">{tr('git.branch.empty')}</p>
        )}
        {groups.map(
          ([label, list]) =>
            list.length > 0 && (
              <div key={label} className="mt-1">
                <h4 className="px-2 py-1 text-label font-medium text-fg-muted">{label}</h4>
                {list.map(b => {
                  const disabled = b.current || !!b.worktree
                  return (
                    <button
                      key={(b.remote ? 'r:' : 'l:') + b.name}
                      type="button"
                      disabled={disabled}
                      onClick={() => onSwitch(b)}
                      title={b.worktree ? `${tr('git.branch.inCopy')} · ${b.worktree}` : b.name}
                      className={cn(
                        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-list',
                        disabled ? 'cursor-default' : 'hover:bg-hover',
                        b.worktree && 'opacity-55',
                      )}
                    >
                      {b.current ? (
                        <Check size={14} className="shrink-0 text-success" aria-label={tr('git.branch.current')} />
                      ) : (
                        <GitBranch size={14} className="shrink-0 text-fg-faint" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-fg">{b.name}</span>
                      {b.worktree && (
                        <span className="shrink-0 text-meta text-fg-faint">{tr('git.branch.inCopy')}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ),
        )}
      </div>
    </div>
  )
}
