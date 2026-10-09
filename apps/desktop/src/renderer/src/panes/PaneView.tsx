import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns2, Ellipsis, FileText, Maximize2, Minimize2, MousePointerClick, Plus, Rows2, X } from 'lucide-react'
import { IconButton, Popover, PopoverItem, Spinner, cn } from '@/components/ui'
import { SessionView } from '@/components/session/SessionView'
import { isLive, useEngineState, useSessionTitle } from '@/engine'
import { SPLIT_DOWN, SPLIT_RIGHT, ZOOM_PANE, withShortcut } from '@/shortcuts'
import { fadeIn, flipFrom } from './motion'
import { notify, paneActions, usePaneState } from './store'
import { isNewTab, isFileTab, parseFileTab, leaves, type Leaf } from './tree'
import { FileEditor } from '@/editor/FileEditor'
import { dirtyFile, showFiles, useFiles } from '@/files/store'
import { isDemo, projects } from '@/data'
import { useSessionActions } from '@/components/sidebar/SessionActions'
import { openRightTab } from '@/components/panel/workspaceStore'
import { useBeginTabDrag } from './drag'
import { dropProblem, type DropTarget } from './drop'

type TabStatus = 'running' | 'waiting' | 'unread' | 'idle'

interface TabInfo {
  title: string
  project: string | null
  status: TabStatus
  file?: boolean
  dirty?: boolean
}

/** 标签的标题、所属项目、状态（运行中 / 待你确认 / 有新回复） */
function useTabInfo(tab: string | null): TabInfo {
  const sessionId = tab && !isNewTab(tab) && !isFileTab(tab) ? tab : null
  const files = useFiles(),
    file = files.tabs.find(t => t.id === tab),
    parsed = tab ? parseFileTab(tab) : null
  const title = useSessionTitle(sessionId)
  const summary = useEngineState(s => (sessionId ? s.sessions.find(x => x.record.id === sessionId) : undefined))
  const project = useEngineState(s =>
    summary ? (s.projects.find(p => p.id === summary.record.projectId)?.name ?? null) : null,
  )
  const unread = useEngineState(s => (sessionId ? !!s.unread[sessionId] : false))
  const pending = useEngineState(s => (sessionId ? (s.snapshots[sessionId]?.pending.length ?? 0) : 0))
  const status: TabStatus = !isLive
    ? 'idle'
    : pending > 0 || summary?.state === 'waiting'
      ? 'waiting'
      : summary && summary.state !== 'idle'
        ? 'running'
        : unread
          ? 'unread'
          : 'idle'
  if (parsed)
    return {
      title: file?.path ?? parsed.path,
      project: file?.project || null,
      status: 'idle',
      file: true,
      dirty: file ? dirtyFile(file) : false,
    }
  return { title: tab === null ? tr('panes.PaneView.message559') : title, project, status }
}

function StatusMark({ status }: { status: TabStatus }) {
  useI18n()
  if (status === 'running') return <Spinner size={11} className="shrink-0" />
  if (status === 'waiting')
    return <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-label={tr('panes.PaneView.message560')} />
  if (status === 'unread')
    return <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={tr('panes.PaneView.message561')} />
  return null
}

export interface PaneViewProps {
  leaf: Leaf
  focused: boolean
  /** 是否画窗格头（只有一个窗格时不画，界面和单会话一样） */
  showHead: boolean
  maximized: boolean
  /** 窗格区的像素尺寸，拆分前检查放不放得下 */
  areaSize: () => { width: number; height: number }
  sidebarOpen: boolean
  panelOpen: boolean
  onToggleSidebar: () => void
  onTogglePanel: () => void
}

/** 一个窗格：窗格头 + 标签条 + 当前标签的会话（其他标签保持挂载，只是隐藏，滚动位置和草稿都还在） */
export const PaneView = memo(function PaneView(props: PaneViewProps) {
  useI18n()
  const { leaf, focused, showHead, maximized } = props
  const info = useTabInfo(leaf.active)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      // 分屏时窗格之间不留缝：分界是 Workspace 画的一条分隔线，当前窗格由 Workspace 的强调色框标出
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-app"
      data-pane-id={leaf.id}
      data-focused={showHead && focused ? '' : undefined}
      onPointerDownCapture={() => paneActions.focus(leaf.id)}
    >
      {showHead && (
        <div
          className={cn('pane-head relative shrink-0 border-b border-line', focused ? 'bg-selected' : 'bg-app')}
          onDoubleClick={e => {
            if ((e.target as HTMLElement).closest('button')) return
            paneActions.toggleMaximize(leaf.id)
          }}
        >
          <div className={cn('pane-head-content flex h-10 items-center gap-2 pr-2 pl-3', !focused && 'opacity-55')}>
            {info.status === 'running' && (
              <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 text-label font-medium text-accent-fg">
                <Spinner size={10} />
                {tr('session.live.agentTrace.message193')}{' '}
              </span>
            )}
            {info.status === 'waiting' && (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-subtle px-2 text-label font-medium text-warn">
                {tr('panes.PaneView.message560')}
              </span>
            )}
            {info.project && (
              <>
                <span className="max-w-[40%] shrink-0 truncate text-ui text-fg-muted">{info.project}</span>
                <span className="shrink-0 text-fg-faint">/</span>
              </>
            )}
            <span className="min-w-0 flex-1 truncate text-ui font-medium text-fg" title={info.title}>
              {info.title}
            </span>
            <IconButton
              icon={maximized ? Minimize2 : Maximize2}
              label={withShortcut(
                maximized ? tr('panes.PaneView.message562') : tr('panes.PaneView.message563'),
                ZOOM_PANE,
              )}
              iconSize={14}
              onClick={() => paneActions.toggleMaximize(leaf.id)}
            />
            <span className="relative">
              <IconButton
                icon={Ellipsis}
                label={tr('session.SessionHeader.message347')}
                active={menuOpen}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onMouseDown={e => menuOpen && e.stopPropagation()}
                onClick={() => setMenuOpen(v => !v)}
              />
              <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="top-full right-0 mt-1">
                <PopoverItem
                  icon={<Columns2 size={15} strokeWidth={1.5} className="text-fg-secondary" />}
                  onClick={() => {
                    setMenuOpen(false)
                    paneActions.focus(leaf.id)
                    paneActions.split('row', props.areaSize())
                  }}
                >
                  {tr('panes.PaneView.message564')} {SPLIT_RIGHT.label}）
                </PopoverItem>
                <PopoverItem
                  icon={<Rows2 size={15} strokeWidth={1.5} className="text-fg-secondary" />}
                  onClick={() => {
                    setMenuOpen(false)
                    paneActions.focus(leaf.id)
                    paneActions.split('col', props.areaSize())
                  }}
                >
                  {tr('panes.PaneView.message565')} {SPLIT_DOWN.label}）
                </PopoverItem>
                <PopoverItem
                  icon={<X size={15} strokeWidth={1.5} className="text-fg-secondary" />}
                  onClick={() => {
                    setMenuOpen(false)
                    paneActions.closePane(leaf.id)
                  }}
                >
                  {tr('panes.PaneView.message566')}{' '}
                </PopoverItem>
              </Popover>
            </span>
            <IconButton
              icon={X}
              label={tr('panes.PaneView.message567')}
              iconSize={15}
              onClick={() => paneActions.closePane(leaf.id)}
            />
          </div>
          {leaf.tabs.length > 0 && <TabStrip leaf={leaf} dim={!focused} areaSize={props.areaSize} />}
        </div>
      )}
      {!showHead && leaf.tabs.length > 0 && (
        <div className="shrink-0 border-b border-line-layout">
          <TabStrip leaf={leaf} dim={false} areaSize={props.areaSize} />
        </div>
      )}

      <div data-pane-content className="relative min-h-0 flex-1">
        {leaf.tabs.length === 0 ? (
          <EmptyPane />
        ) : (
          leaf.tabs.map(tab => <TabBody key={tab} tab={tab} active={tab === leaf.active} {...props} />)
        )}
      </div>
    </div>
  )
})

/** 一个标签的内容：不是当前标签时隐藏但保持挂载；切过来时淡入 */
function TabBody({
  tab,
  active,
  sidebarOpen,
  panelOpen,
  onToggleSidebar,
  onTogglePanel,
}: { tab: string; active: boolean } & PaneViewProps) {
  useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const wasActive = useRef(active)
  const sessionId = isNewTab(tab) || isFileTab(tab) ? null : tab
  const title = useSessionTitle(sessionId)

  useLayoutEffect(() => {
    if (active && !wasActive.current && ref.current) fadeIn(ref.current)
    wasActive.current = active
  }, [active])

  return (
    <div
      ref={ref}
      className={cn('absolute inset-0 flex', !active && 'invisible')}
      aria-hidden={!active || undefined}
      inert={!active}
    >
      {isFileTab(tab) ? (
        <FileEditor id={tab} active={active} />
      ) : (
        <SessionView
          embedded
          sessionId={sessionId}
          draftKey={isLive ? tab : `demo:${tab}`}
          title={title}
          sidebarOpen={sidebarOpen}
          panelOpen={panelOpen}
          onToggleSidebar={onToggleSidebar}
          onTogglePanel={onTogglePanel}
          onOpenSession={id => paneActions.replace(tab, id)}
        />
      )}
    </div>
  )
}

/** 标签条：标签增减、位置变化时其余标签平滑移位（FLIP） */
function TabStrip({ leaf, dim, areaSize }: { leaf: Leaf; dim: boolean; areaSize: PaneViewProps['areaSize'] }) {
  useI18n()
  const refs = useRef(new Map<string, HTMLDivElement>())
  const prev = useRef(new Map<string, number>())
  const seen = useRef(new Set(leaf.tabs))
  const [menu, setMenu] = useState<{ tab: string; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const next = new Map<string, number>()
    for (const [tab, el] of refs.current) {
      const left = el.offsetLeft
      next.set(tab, left)
      const old = prev.current.get(tab)
      if (old !== undefined) flipFrom(el, old - left, 0, 200)
    }
    prev.current = next
  })

  const isNew = (tab: string): boolean => {
    if (seen.current.has(tab)) return false
    seen.current.add(tab)
    return true
  }

  return (
    <div
      data-tab-strip
      role="tablist"
      aria-label={tr('panes.PaneView.message568')}
      className={cn(
        'pane-head-content flex items-center gap-1 overflow-x-auto px-2 pt-1 pb-1.5 [scrollbar-width:none]',
        dim && 'opacity-55',
      )}
    >
      {leaf.tabs.map(tab => (
        <Tab
          key={tab}
          tab={tab}
          leafId={leaf.id}
          active={tab === leaf.active}
          entering={isNew(tab)}
          onMenu={(x, y) => setMenu({ tab, x, y })}
          refCb={el => {
            if (el) refs.current.set(tab, el)
            else refs.current.delete(tab)
          }}
        />
      ))}
      <button
        type="button"
        aria-label={tr('panes.PaneView.message569')}
        title={tr('panes.PaneView.message569')}
        onClick={() => {
          paneActions.focus(leaf.id)
          paneActions.open(null)
        }}
        className="press flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Plus size={14} strokeWidth={1.5} />
      </button>
      {menu && (
        <TabMenu
          leaf={leaf}
          menu={menu}
          areaSize={areaSize}
          onClose={() => {
            setMenu(null)
            requestAnimationFrame(() => {
              if (!document.querySelector('[aria-modal="true"]')) refs.current.get(menu.tab)?.focus()
            })
          }}
        />
      )}
    </div>
  )
}

function Tab({
  tab,
  leafId,
  active,
  entering,
  refCb,
  onMenu,
}: {
  tab: string
  leafId: string
  active: boolean
  entering: boolean
  refCb: (el: HTMLDivElement | null) => void
  onMenu: (x: number, y: number) => void
}) {
  useI18n()
  const info = useTabInfo(tab)
  const beginDrag = useBeginTabDrag()
  return (
    <div
      ref={refCb}
      data-tab-id={tab}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tr('panes.PaneView.message570', { p0: info.title })}
      onPointerDown={e => beginDrag(e, tab, info.title)}
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          onMenu(r.left, r.bottom)
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          paneActions.activate(leafId, tab)
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          const strip = e.currentTarget.parentElement
          e.preventDefault()
          paneActions.focus(leafId)
          paneActions.cycleTab(e.key === 'ArrowLeft' ? -1 : 1)
          requestAnimationFrame(() => strip?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
        }
      }}
      onClick={() => paneActions.activate(leafId, tab)}
      onAuxClick={e => e.button === 1 && paneActions.closeTab(leafId, tab)}
      className={cn(
        'group/tab flex h-7 max-w-[min(36rem,80vw)] shrink-0 cursor-grab touch-none items-center gap-1.5 rounded-md border pr-1 pl-2 text-meta select-none transition-colors',
        active
          ? 'border-line bg-surface text-fg shadow-sm'
          : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg',
        entering && 'pane-tab-in',
      )}
    >
      {info.file ? <FileText size={12} className="shrink-0 text-fg-muted" /> : <StatusMark status={info.status} />}
      <span className="truncate">{info.file ? info.title.split('/').pop() : info.title}</span>
      {info.dirty && (
        <span aria-label={tr('panes.PaneView.message571')} className="size-1.5 shrink-0 rounded-full bg-fg-muted" />
      )}
      <button
        type="button"
        aria-label={tr('panes.PaneView.message572', { p0: info.title })}
        onClick={e => {
          e.stopPropagation()
          paneActions.closeTab(leafId, tab)
        }}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg',
          active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
        )}
      >
        <X size={11} strokeWidth={1.75} />
      </button>
    </div>
  )
}

/** 使用独立浮层，避免右键菜单被窄窗格或标签栏的滚动裁切。 */
function TabMenu({
  leaf,
  menu,
  areaSize,
  onClose,
}: {
  leaf: Leaf
  menu: { tab: string; x: number; y: number }
  areaSize: PaneViewProps['areaSize']
  onClose: () => void
}) {
  useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const layout = usePaneState(s => s.layout)
  const closing = usePaneState(s => s.closing)
  const all = leaves(layout.root)
  const sessionActions = useSessionActions()
  const summary = useEngineState(s => s.sessions.find(row => row.record.id === menu.tab))
  const info = useTabInfo(menu.tab)
  const demo = projects.flatMap(p => [...p.sessions, ...(p.archived ?? [])]).find(row => row.id === menu.tab)
  const sessionTarget =
    !isNewTab(menu.tab) && !isFileTab(menu.tab) && (summary || demo)
      ? {
          id: menu.tab,
          title: info.title,
          archived: !!summary?.record.archivedAt || !!demo?.archivedAt,
          running: summary ? summary.state !== 'idle' : demo?.status === 'running',
        }
      : null
  const index = leaf.tabs.indexOf(menu.tab)
  const choices: { label: string; target: DropTarget; disabled?: boolean }[] = [
    {
      get label() {
        return tr('panes.PaneView.message573')
      },
      target: { leafId: leaf.id, index: index - 1 },
      disabled: index <= 0,
    },
    {
      get label() {
        return tr('panes.PaneView.message574')
      },
      target: { leafId: leaf.id, index: index + 2 },
      disabled: index >= leaf.tabs.length - 1,
    },
    {
      get label() {
        return tr('panes.drag.message549')
      },
      target: { leafId: leaf.id, edge: 'left' },
    },
    {
      get label() {
        return tr('panes.drag.message550')
      },
      target: { leafId: leaf.id, edge: 'right' },
    },
    {
      get label() {
        return tr('panes.drag.message551')
      },
      target: { leafId: leaf.id, edge: 'top' },
    },
    {
      get label() {
        return tr('panes.drag.message552')
      },
      target: { leafId: leaf.id, edge: 'bottom' },
    },
    ...all.flatMap((l, i) =>
      l.id === leaf.id || closing[l.id]
        ? []
        : [{ label: tr('panes.PaneView.message575', { p0: i + 1 }), target: { leafId: l.id, index: l.tabs.length } }],
    ),
  ]
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8))}px`
    el.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  }, [menu.x, menu.y])
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  if (index < 0) return null
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={tr('panes.PaneView.message576')}
      className="pop-in no-drag fixed z-50 max-h-[calc(100vh-16px)] min-w-48 overflow-y-auto rounded-lg border border-line-card bg-popover p-1 shadow-menu"
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={e => {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        } else if (e.key === 'Tab') onClose()
        else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
          items[next]?.focus()
        }
        e.stopPropagation()
      }}
    >
      {sessionTarget && (
        <>
          {(['rename', 'delete'] as const).map(action => (
            <button
              key={action}
              role="menuitem"
              disabled={sessionActions.busy}
              className={cn(
                'flex h-8 w-full items-center rounded-md px-2 text-left text-ui hover:bg-hover',
                action === 'delete' ? 'text-danger' : 'text-fg',
              )}
              onClick={() => {
                onClose()
                sessionActions.request(action, sessionTarget)
              }}
            >
              {tr(action === 'rename' ? 'session.rename' : 'session.delete')}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
        </>
      )}
      {parseFileTab(menu.tab) && (
        <>
          <button
            role="menuitem"
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-ui text-fg hover:bg-hover"
            onClick={() => {
              paneActions.detachFileTab(menu.tab)
              openRightTab(menu.tab)
              onClose()
            }}
          >
            {tr('workspace.moveRight')}
          </button>
          <button
            role="menuitem"
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-ui text-fg hover:bg-hover"
            onClick={() => {
              const file = parseFileTab(menu.tab)!
              showFiles(file.ref, file.path)
              onClose()
            }}
          >
            {tr('panes.PaneView.message577')}
          </button>
          <button
            role="menuitem"
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-ui text-fg hover:bg-hover"
            onClick={() => {
              const file = parseFileTab(menu.tab)!
              if (!isDemo) void window.pixelsky!.files.copyPath(file.ref, file.path)
              onClose()
            }}
          >
            {tr('panes.PaneView.message578')}
          </button>
          <button
            role="menuitem"
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-ui text-fg hover:bg-hover"
            onClick={() => {
              const file = parseFileTab(menu.tab)!
              if (!isDemo)
                void window.pixelsky!.editor.open(file.ref, undefined, file.path).catch(e => notify(e.message))
              onClose()
            }}
          >
            {tr('panes.PaneView.message579')}
          </button>
          <div className="my-1 border-t border-line" />
        </>
      )}
      {choices.map(choice => {
        const problem = choice.disabled ? null : dropProblem(layout, menu.tab, choice.target, areaSize())
        return (
          <button
            key={choice.label}
            role="menuitem"
            type="button"
            disabled={choice.disabled || !!problem}
            title={problem ?? undefined}
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-ui text-fg hover:bg-hover disabled:cursor-default disabled:text-fg-faint disabled:hover:bg-transparent"
            onClick={() => {
              paneActions.dropTab(menu.tab, choice.target, areaSize())
              onClose()
            }}
          >
            {choice.label}
          </button>
        )
      })}
      <button
        role="menuitem"
        type="button"
        className="mt-1 flex h-8 w-full items-center rounded-md border-t border-line px-2 text-left text-ui text-fg hover:bg-hover"
        onClick={() => {
          paneActions.closeTab(leaf.id, menu.tab)
          onClose()
        }}
      >
        {tr('panel.PanelTabs.message85')}
      </button>
    </div>,
    document.body,
  )
}

function EmptyPane() {
  useI18n()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-fg-muted">
      <MousePointerClick size={22} strokeWidth={1.5} />
      <span className="text-ui">{tr('panes.PaneView.message580')}</span>
      <span className="text-meta text-fg-faint">
        {SPLIT_RIGHT.label}
        {tr('panes.PaneView.message581')} {SPLIT_DOWN.label}
        {tr('panes.PaneView.message582')}{' '}
      </span>
      <button
        type="button"
        onClick={() => paneActions.open(null)}
        className="press mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-ui font-medium text-fg shadow-sm hover:border-fg-faint"
      >
        <Plus size={15} strokeWidth={1.5} />
        {tr('sidebar.NewTaskButton.message392')}{' '}
      </button>
    </div>
  )
}
