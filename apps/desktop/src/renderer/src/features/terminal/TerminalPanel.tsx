import { machineOf, useMachines } from '@/features/machines/store'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  TerminalSquare,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { cn, IconButton, Select } from '@/ui'
import { ResizeHandle } from '@/ui/ResizeHandle'
import { useSettings } from '@/features/settings/SettingsProvider'
import { useEngineState } from '@/features/engine'
import { addProject } from '@/features/engine/store'
import { isDemo, projects as demoProjects } from '@/data'
import { useTerminalUi } from './TerminalProvider'
import { useTerminalStore, terminalError } from './store'
import { TerminalView } from './TerminalView'
import { screens } from './screens'
import { createPortal } from 'react-dom'
import { ActionMenu } from '@/ui/ActionMenu'
import { workspaceTerminals } from './workspace'

export function TerminalPanel({ embedded = false, visible = true }: { embedded?: boolean; visible?: boolean }) {
  const { t, text } = useI18n(),
    ui = useTerminalUi(),
    state = useTerminalStore(),
    settings = useSettings()
  const realProjects = useEngineState(s => s.projects)
  const machines = useMachines()
  const projects = isDemo ? demoProjects : realProjects.filter(p => machineOf(p.id) === machines.currentId)
  const panel = useRef<HTMLElement>(null),
    tabs = useRef<HTMLDivElement>(null),
    moreRef = useRef<HTMLButtonElement>(null)
  const [maxHeight, setMaxHeight] = useState(620),
    [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [context, setContext] = useState<{ id: string; x: number; y: number; trigger: HTMLElement } | null>(null)
  const [query, setQuery] = useState(''),
    [found, setFound] = useState(true)
  const items = workspaceTerminals(
    state.terminals,
    ui.projectId,
    ui.workspacePath,
    machines.currentId === 'local' && window.pixelsky?.platform === 'win32',
  )
  const active = items.find(r => r.id === ui.activeId) ?? null
  const visibleProjects = [
    ...projects.map(p => ({ value: p.id, label: p.name })),
    ...state.terminals
      .filter(r => !projects.some(p => p.id === r.projectId))
      .map(r => ({ value: r.projectId, label: r.projectName })),
  ].filter((p, i, list) => list.findIndex(other => other.value === p.value) === i)
  const menuClose = (): void => {
    setMenu(null)
    moreRef.current?.focus()
  }
  useEffect(() => {
    if (embedded) return
    const parent = panel.current?.parentElement
    if (!parent) return
    const resize = (): void => {
      const height = parent.clientHeight - 240
      setMaxHeight(Math.max(160, height))
      if (height < 160 && ui.open && !ui.maximized) ui.toggle()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    resize()
    return () => observer.disconnect()
  }, [ui.open, ui.maximized, embedded])
  useEffect(() => {
    const el = tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!el || !tabs.current) return
    const left = el.offsetLeft,
      width = el.offsetWidth,
      container = tabs.current
    if (left < container.scrollLeft) container.scrollLeft = left
    else if (left + width > container.scrollLeft + container.clientWidth)
      container.scrollLeft = left + width - container.clientWidth
  }, [ui.activeId, items.length])
  useEffect(() => {
    if (!menu) return
    const dismiss = () => setMenu(null)
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [menu])
  useEffect(() => {
    setQuery('')
    setFound(true)
  }, [ui.searchId])
  const cycle = (delta: number): void => {
    if (items.length)
      ui.select(
        items[
          (Math.max(
            0,
            items.findIndex(r => r.id === active?.id),
          ) +
            delta +
            items.length) %
            items.length
        ].id,
      )
  }
  const find = (backwards = false): void => {
    if (active && query) setFound(screens.get(active.id)?.find(query, backwards) ?? false)
  }
  const projectOptions = [{ value: '', label: t('terminal.chooseProject') }, ...visibleProjects]
  return (
    <section
      ref={panel}
      data-terminal-panel
      hidden={!(embedded ? visible : ui.open)}
      inert={!(embedded ? visible : ui.open)}
      className={cn(
        'terminal-panel min-h-0 shrink-0 flex-col border-t border-line-layout bg-panel',
        (embedded ? visible : ui.open) ? 'flex' : 'hidden',
        embedded && 'flex-1',
        !embedded && ui.maximized && 'terminal-panel-maximized',
      )}
      style={{ height: embedded || ui.maximized ? undefined : Math.min(ui.height, maxHeight) }}
    >
      {!embedded && !ui.maximized && (
        <ResizeHandle
          axis="y"
          scale={-1}
          className="terminal-resize"
          label={t('terminal.height')}
          value={Math.min(ui.height, maxHeight)}
          min={160}
          max={maxHeight}
          onChange={ui.setHeight}
          onCommit={ui.setHeight}
          onReset={() => ui.setHeight(280)}
        />
      )}
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-line-layout px-3">
        <Select
          label={t('terminal.project')}
          value={ui.projectId ?? ''}
          options={projectOptions}
          onChange={ui.selectProject}
          className="terminal-project-select"
        />
        <div
          ref={tabs}
          role="tablist"
          aria-label={t('terminal.title')}
          className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        >
          {items.map(item => (
            <div
              key={item.id}
              onContextMenu={e => {
                e.preventDefault()
                setContext({
                  id: item.id,
                  x: e.clientX,
                  y: e.clientY,
                  trigger: e.currentTarget.querySelector('button')!,
                })
              }}
              className={cn(
                'flex h-7 max-w-[min(36rem,75vw)] shrink-0 items-center rounded-md',
                item.id === active?.id ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={item.id === active?.id}
                tabIndex={item.id === active?.id ? 0 : -1}
                onClick={() => ui.select(item.id)}
                onDoubleClick={() => void ui.request('rename', item.id)}
                onKeyDown={e => {
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setContext({ id: item.id, x: r.left, y: r.bottom, trigger: e.currentTarget })
                  }
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault()
                    cycle(e.key === 'ArrowRight' ? 1 : -1)
                  }
                }}
                title={item.title + ' · ' + item.cwd}
                className="flex min-w-0 items-center gap-1.5 px-2 text-meta"
              >
                <TerminalSquare size={14} className="shrink-0" />
                <span className="truncate">{item.title}</span>
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    item.status === 'running' ? 'bg-online' : 'bg-fg-faint',
                  )}
                />
              </button>
              <button
                aria-label={t('terminal.close') + ': ' + item.title}
                onClick={() => void ui.request('close', item.id)}
                className="mr-1 rounded p-0.5 hover:bg-hover"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <IconButton
          icon={Plus}
          label={t('terminal.new')}
          size={28}
          iconSize={15}
          onClick={() => void ui.create()}
          disabled={!ui.projectId || !state.ready}
        />
        <Select
          label={t('terminal.selectShell')}
          placeholder={t('terminal.selectShell')}
          value=""
          fitContent
          options={state.profiles.map(p => ({
            value: p.id,
            label: p.label,
            disabled: !p.available,
            description: p.available ? undefined : t('terminal.notDetected'),
          }))}
          onChange={id => void ui.create(undefined, id)}
          disabled={!ui.projectId}
          className="terminal-shell-select"
        />
        <IconButton
          icon={Search}
          label={t('terminal.search')}
          size={28}
          iconSize={14}
          disabled={!active}
          active={!!active && ui.searchId === active.id}
          aria-expanded={!!active && ui.searchId === active.id}
          onClick={() => {
            if (active && ui.searchId === active.id) ui.stopSearch()
            else void ui.request('search')
          }}
        />
        <button
          ref={moreRef}
          aria-label={t('terminal.more')}
          aria-expanded={!!menu}
          aria-haspopup="menu"
          onClick={() => {
            if (menu) {
              menuClose()
              return
            }
            const r = moreRef.current!.getBoundingClientRect()
            setMenu({ x: Math.max(8, r.right - 200), y: Math.max(8, r.top - 230) })
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover"
        >
          <MoreHorizontal size={15} />
        </button>
        {!embedded && (
          <IconButton
            icon={ui.maximized ? Minimize2 : Maximize2}
            label={t(ui.maximized ? 'terminal.restore' : 'terminal.maximize')}
            size={28}
            iconSize={14}
            onClick={ui.toggleMaximize}
          />
        )}
        {!embedded && (
          <IconButton icon={ChevronDown} label={t('terminal.collapse')} size={28} iconSize={14} onClick={ui.toggle} />
        )}
      </header>
      {state.error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-2 bg-panel px-3 py-1 text-meta text-danger"
        >
          <span className="break-words">{state.error}</span>
          <IconButton icon={X} label={t('terminal.dismiss')} size={24} onClick={() => terminalError(null)} />
        </div>
      )}
      {active && ui.searchId === active.id && (
        <div
          data-terminal-search
          className="mx-3 my-2 flex h-9 shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2 focus-within:border-accent-line focus-within:ring-2 focus-within:ring-composer-ring"
        >
          <Search size={14} className="shrink-0 text-fg-muted" />
          <input
            autoFocus
            placeholder={t('workspace.terminalSearch')}
            aria-label={t('terminal.search')}
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              if (active) setFound(!e.target.value || (screens.get(active.id)?.find(e.target.value) ?? false))
            }}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Escape') {
                e.stopPropagation()
                ui.stopSearch()
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                find(e.shiftKey)
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-meta outline-none"
          />
          <span className="text-label text-fg-muted">{!found && t('terminal.noMatches')}</span>
          <IconButton icon={ArrowUp} label={t('terminal.previous')} size={24} onClick={() => find(true)} />
          <IconButton icon={ArrowDown} label={t('terminal.next')} size={24} onClick={() => find()} />
          <IconButton icon={X} label={t('terminal.closeSearch')} size={24} onClick={ui.stopSearch} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col bg-terminal">
        {!active && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-fg">
            <TerminalSquare size={25} className="text-fg-faint" />
            <p className="text-ui">{t(ui.projectId ? 'terminal.noTerminals' : 'terminal.chooseProject')}</p>
            <button
              onClick={() => {
                if (ui.projectId) void ui.create()
                else if (!isDemo)
                  void addProject()
                    .then(id => {
                      if (id) {
                        ui.selectProject(id)
                        return ui.create({ projectId: id })
                      }
                    })
                    .catch(terminalError)
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-ui text-primary-fg"
            >
              {t(ui.projectId ? 'terminal.new' : 'terminal.addProject')}
            </button>
          </div>
        )}
        {state.terminals.map(record => (
          <TerminalView
            key={record.id}
            record={record}
            visible={(embedded ? visible : ui.open) && active?.id === record.id}
            onPaste={ui.paste}
            onFind={() => void ui.request('search', record.id)}
            onCycle={cycle}
          />
        ))}
      </div>
      {active && (
        <footer className="flex min-h-7 shrink-0 items-center gap-3 border-t border-line-layout px-3 text-label text-fg-muted">
          <span className="shrink-0">
            {t(('terminal.' + active.status) as 'terminal.running')}
            {active.exitCode !== undefined ? ' · ' + t('terminal.exitCode', { p0: active.exitCode }) : ''}
          </span>
          <span title={active.cwd} className="min-w-0 flex-1 truncate">
            {t('terminal.cwd')}: {active.cwd}
          </span>
          {active.error && (
            <span role="alert" title={text(active.error)} className="max-w-48 truncate text-danger">
              {text(active.error)}
            </span>
          )}
          {['stopped', 'error', 'exited'].includes(active.status) && (
            <button className="shrink-0 text-accent-fg" onClick={() => void ui.request('restart')}>
              {t('terminal.start')}
            </button>
          )}
        </footer>
      )}
      {context && (
        <ActionMenu
          x={context.x}
          y={context.y}
          label={t('terminal.more')}
          onClose={() => {
            setContext(null)
            context.trigger.focus({ preventScroll: true })
          }}
          actions={(['rename', 'close', 'clear', 'restart'] as const).map(action => ({
            label: t(action === 'close' ? 'workspace.removeTerminal' : `terminal.${action}`),
            danger: action === 'close',
            run: () => void ui.request(action, context.id),
          }))}
        />
      )}
      {menu &&
        createPortal(
          <TerminalMenu x={menu.x} y={menu.y} close={menuClose}>
            {(['rename', 'search', 'clear', 'restart', 'close'] as const).map(action => (
              <button
                key={action}
                role="menuitem"
                disabled={!active}
                onClick={() => {
                  menuClose()
                  void ui.request(action)
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-list hover:bg-hover disabled:opacity-40"
              >
                {t(('terminal.' + action) as 'terminal.rename')}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => {
                menuClose()
                settings.openSettings('terminal')
              }}
              className="flex w-full items-center gap-2 rounded-md border-t border-line px-3 py-2 text-list hover:bg-hover"
            >
              <Settings size={14} />
              {t('terminal.settings')}
            </button>
          </TerminalMenu>,
          document.body,
        )}
    </section>
  )
}
function TerminalMenu({ x, y, close, children }: { x: number; y: number; close(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  }, [])
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[70] w-52 rounded-lg border border-line-card bg-popover p-1 text-fg shadow-menu"
      style={{ left: x, top: y }}
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => {
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault()
          close()
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }
      }}
    >
      {children}
    </div>
  )
}
