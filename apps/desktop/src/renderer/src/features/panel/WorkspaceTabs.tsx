import { useLayoutEffect, useRef, useState } from 'react'
import {
  Box,
  Copy,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  ListChecks,
  Maximize2,
  Minimize2,
  Package,
  Plus,
  SquareTerminal,
  X,
} from 'lucide-react'
import { cn, CountBadge, IconButton } from '@/ui'
import { useInbox } from './inbox/useInbox'
import { ActionMenu, type MenuAction } from '@/ui/ActionMenu'
import { useI18n } from '@/i18n/I18nProvider'
import { dirtyFile, useFiles } from '@/features/files/store'
import { parseFileTab } from '@/features/panes/tree'
import { panelCloseTargets, TOOL_IDS, type PanelLayout, type ToolId } from './workspaceState'

const icons: Partial<Record<string, typeof FolderTree>> = {
  files: FolderTree,
  git: GitBranch,
  artifacts: Package,
  terminal: SquareTerminal,
  browser: Globe,
  tasks: ListChecks,
  sandbox: Box,
  copies: Copy,
}
export function WorkspaceTabs({
  layout,
  maximized,
  busy,
  onSelect,
  onClose,
  onMoveFile,
}: {
  layout: PanelLayout
  maximized: boolean
  busy: boolean
  onSelect(id: string): void
  onClose(ids: string[]): void
  onMoveFile(id: string): void
}) {
  const { t, text } = useI18n(),
    files = useFiles(),
    strip = useRef<HTMLDivElement>(null)
  // 任务标签上显示待处理数量（docs/ui/tasks-inbox.md §2）
  const inboxCount = useInbox().length
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number; trigger: HTMLElement } | null>(null)
  const label = (id: string): string =>
    files.tabs.find(f => f.id === id)?.name ??
    parseFileTab(id)?.path.split('/').pop() ??
    (TOOL_IDS.includes(id as ToolId) ? t(`workspace.${id as ToolId}`) : id)
  useLayoutEffect(() => {
    const list = strip.current
    const reveal = () => {
      const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement
      if (!list || !tab) return
      if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft
      else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth)
        list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    if (list) observer.observe(list)
    return () => observer.disconnect()
  }, [layout.active, layout.tabs.length])
  const actions: MenuAction[] = menu?.id
    ? [
        ...(parseFileTab(menu.id) ? [{ label: t('workspace.moveChat'), run: () => onMoveFile(menu.id!) }] : []),
        ...(['one', 'others', 'right', 'all'] as const).map(mode => ({
          label: t(mode === 'one' ? 'workspace.close' : `workspace.${mode}`),
          disabled: busy || !panelCloseTargets(layout, menu.id!, mode).length,
          run: () => onClose(panelCloseTargets(layout, menu.id!, mode)),
        })),
      ]
    : TOOL_IDS.map(id => ({ label: t(`workspace.${id}`), run: () => onSelect(id) }))
  return (
    <div data-panel-tabs className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-line-layout px-2">
      <div
        ref={strip}
        role="tablist"
        aria-label={t('workspace.title')}
        className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {layout.tabs.map(id => {
          const Icon = icons[id] ?? FileText,
            file = files.tabs.find(f => f.id === id)
          return (
            <div
              key={id}
              className={cn(
                'group flex h-7 max-w-[min(32rem,80vw)] shrink-0 items-center gap-1 rounded-md border pr-1',
                id === layout.active
                  ? 'border-line bg-surface text-fg shadow-sm'
                  : 'border-transparent text-fg-muted hover:bg-hover',
              )}
              onContextMenu={e => {
                e.preventDefault()
                setMenu({ id, x: e.clientX, y: e.clientY, trigger: e.currentTarget })
              }}
            >
              <button
                type="button"
                data-workspace-tab={id}
                role="tab"
                tabIndex={id === layout.active ? 0 : -1}
                aria-selected={id === layout.active}
                title={file ? `${file.project} / ${file.path}` : (parseFileTab(id)?.path ?? label(id))}
                className="flex h-full min-w-0 items-center gap-1.5 rounded-md px-2 text-meta"
                onClick={() => onSelect(id)}
                onKeyDown={e => {
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ id, x: r.left, y: r.bottom, trigger: e.currentTarget })
                  }
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    const next =
                      layout.tabs[
                        (layout.tabs.indexOf(id) + (e.key === 'ArrowRight' ? 1 : -1) + layout.tabs.length) %
                          layout.tabs.length
                      ]
                    onSelect(next)
                    requestAnimationFrame(() =>
                      strip.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(),
                    )
                  }
                }}
              >
                <Icon size={14} className="shrink-0" />
                <span className="truncate">{label(id)}</span>
                {id === 'tasks' && inboxCount > 0 && <CountBadge count={inboxCount} className="shrink-0" />}
                {file && dirtyFile(file) && (
                  <span aria-label={text('未保存')} className="size-1.5 shrink-0 rounded-full bg-fg-muted" />
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`${t('workspace.close')}: ${label(id)}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg"
                onClick={() => onClose([id])}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <IconButton
        icon={Plus}
        label={t('workspace.add')}
        size={28}
        iconSize={15}
        aria-haspopup="menu"
        aria-expanded={menu?.id === null}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu(menu ? null : { id: null, x: r.left, y: r.bottom, trigger: e.currentTarget })
        }}
      />
      <IconButton
        icon={maximized ? Minimize2 : Maximize2}
        label={text(maximized ? '还原面板' : '放大面板')}
        size={28}
        iconSize={15}
        onClick={() => window.dispatchEvent(new Event('pixelsky:panel-maximize'))}
      />
      <IconButton
        icon={X}
        label={text('收起右侧面板')}
        size={28}
        iconSize={15}
        onClick={() => window.dispatchEvent(new Event('pixelsky:close-right-workspace'))}
      />
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={t('workspace.title')}
          actions={actions}
          onClose={() => {
            setMenu(null)
            menu.trigger.focus({ preventScroll: true })
          }}
        />
      )}
    </div>
  )
}
