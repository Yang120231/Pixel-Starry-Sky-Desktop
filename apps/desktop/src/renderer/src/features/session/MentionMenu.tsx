// 输入 @ 时弹出的项目文件列表（docs/ui/workbench-ux-3.md §2.6），样式和命令菜单（CommandMenu）一样
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { File, Folder } from 'lucide-react'
import { cn } from '@/ui'
import { tr } from '@/i18n/core'
import { keyRef, refKey } from '@/features/editor/target'
import type { FileEntry, WorkspaceRef } from '../../../../shared/types/workspace'
import { MENTION_LIMIT, rankEntries, splitQuery } from './mention'

/** 没写名字时列出那一层目录，写了名字按文件名找（和文件树筛选同一个）；去抖 150ms，旧的结果不覆盖新的 */
export function useMentionEntries(
  ref: WorkspaceRef | null,
  query: string | null,
): { entries: FileEntry[]; loading: boolean } {
  const [result, setResult] = useState<{ query: string; entries: FileEntry[] } | null>(null)
  const key = ref ? refKey(ref) : null
  useEffect(() => {
    const files = window.pixelsky?.files
    if (query === null || !key || !files) return
    const ref = keyRef(key)
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const { dir, name } = splitQuery(query)
      let entries: FileEntry[] = []
      try {
        entries = name
          ? rankEntries((await files.search(ref, name)).entries, dir, name)
          : ((await files.listExisting(ref, dir))?.entries.slice(0, MENTION_LIMIT) ?? [])
      } catch {
        // 目录不存在、远端断开：当作没有匹配
      }
      if (!cancelled) setResult({ query, entries })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, query])
  if (query === null) return { entries: [], loading: false }
  return { entries: result?.entries ?? [], loading: result?.query !== query }
}

export function MentionMenu({
  id,
  entries,
  loading,
  selected,
  onChoose,
}: {
  id: string
  entries: FileEntry[]
  loading: boolean
  selected: number
  onChoose: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    const option = list?.querySelector<HTMLElement>(`[data-mention-index="${selected}"]`)
    if (!list || !option) return
    // 只移动候选列表，不连带对话或窗格
    const viewport = list.getBoundingClientRect(),
      row = option.getBoundingClientRect()
    if (row.top < viewport.top) list.scrollTop += row.top - viewport.top
    else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom
  }, [entries, selected])

  return (
    <div className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-lg border border-line-card bg-popover p-1 shadow-menu">
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={tr('composer.mention.label')}
        aria-busy={loading}
        className="max-h-72 overflow-y-auto overscroll-contain"
      >
        {entries.length === 0 && (
          <div className="px-3 py-2 text-meta text-fg-muted">
            {loading ? tr('composer.mention.loading') : tr('composer.mention.empty')}
          </div>
        )}
        {entries.map((entry, index) => {
          const dir = entry.path.slice(0, entry.path.length - entry.name.length).replace(/\/$/, '')
          const Icon = entry.kind === 'directory' ? Folder : File
          return (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={`${id}-${index}`}
              key={entry.path}
              data-mention-index={index}
              aria-selected={index === selected}
              onMouseDown={event => event.preventDefault()}
              onClick={() => onChoose(index)}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-list',
                index === selected ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              <Icon
                size={14}
                strokeWidth={1.5}
                className={cn('shrink-0', entry.kind === 'directory' ? 'text-accent-fg' : 'text-fg-muted')}
              />
              <span className="shrink-0 font-medium">
                {entry.name}
                {entry.kind === 'directory' ? '/' : ''}
              </span>
              {dir && <span className="min-w-0 truncate text-meta text-fg-muted">{dir}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
