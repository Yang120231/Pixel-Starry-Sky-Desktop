import { openMachineManager, openWorkspacePicker } from '@/features/machines/store'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  Bell,
  BellOff,
  Command,
  File,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Package,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Palette,
  Search,
  Settings,
  Split,
  TerminalSquare,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { useSettings } from '@/features/settings/SettingsProvider'
import type { SectionId } from '@/features/settings/SettingsDialog'
import { useOpenSearch } from '@/features/search/SearchProvider'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import { terminalState } from '@/features/terminal/store'
import { useActiveWorkspace } from '@/features/editor/target'
import { cn, Kbd, useToast } from '@/ui'
import {
  OPEN_SEARCH,
  SPLIT_DOWN,
  SPLIT_RIGHT,
  TOGGLE_PANEL,
  TOGGLE_SIDEBAR,
  ZOOM_PANE,
} from '@/features/layout/shortcuts'
import { getPaneState, paneActions } from '@/features/panes/store'
import { getPage, setPage, showWorkbench } from '@/features/layout/page'
import { getNotificationPrefs, setNotificationPrefs } from '@/features/settings/notifications'
import { requestGitAction } from '@/features/panel/git/GitPanel'
import { focusedTab, isFileTab, isNewTab, findLeaf } from '@/features/panes/tree'
import { useTheme } from '@/features/appearance/ThemeProvider'
import { allMessages, tr, translateMessage, type TranslationKey } from '@/i18n/core'
import { useSessionActions, type SessionTarget } from '@/features/sidebar/SessionActions'
import { getEngineState } from '@/features/engine/store'
import { getPanelLayout, getPanelScope, openRightTab } from '@/features/panel/workspaceStore'
import { getFiles, saveFile, showFiles } from '@/features/files/store'
import { isDemo, projects } from '@/data'
import { rankCommands } from './rank'
import { demoSessionChanges } from '@/data/demo'

interface CommandItem {
  id: string
  label: string
  keywords: string
  category: string
  icon: LucideIcon
  shortcut?: string
  reason?: string
  valid?: () => boolean
  run: () => void | boolean | Promise<unknown>
}
const Context = createContext<{ open(): void; isOpen: boolean } | null>(null)
const HISTORY_KEY = isDemo ? 'pixelsky.command-history.demo' : 'pixelsky.command-history'
function history(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}
function sessionTarget(id: string | null): SessionTarget | null {
  if (!id || isFileTab(id) || isNewTab(id)) return null
  if (isDemo) {
    const s = projects.flatMap(p => [...p.sessions, ...(p.archived ?? [])]).find(s => s.id === id),
      change = demoSessionChanges()[id]
    if (!s || change?.deleted) return null
    return {
      id,
      title: change?.title ?? s.title,
      archived: !!(change?.archivedAt ?? s.archivedAt),
      bottomed: !!(change?.bottomedAt ?? s.bottomedAt),
      running: !change?.stopped && s.status === 'running',
    }
  }
  const state = getEngineState(),
    s = state.snapshots[id],
    summary = state.sessions.find(s => s.record.id === id),
    r = s?.record ?? summary?.record
  return r
    ? {
        id,
        title: r.title,
        archived: !!r.archivedAt,
        bottomed: !!r.bottomedAt,
        running: (s?.state ?? summary?.state ?? 'idle') !== 'idle',
      }
    : null
}
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n(),
    settings = useSettings(),
    openSearch = useOpenSearch(),
    terminal = useTerminalUi(),
    theme = useTheme(),
    workspace = useActiveWorkspace(),
    sessions = useSessionActions(),
    toast = useToast()
  const [open, setOpen] = useState(false),
    [commands, setCommands] = useState<CommandItem[]>([]),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(0),
    [recent, setRecent] = useState(history)
  const input = useRef<HTMLInputElement>(null),
    popup = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    executing = useRef(false)
  const build = (): CommandItem[] => {
    const layout = getPaneState().layout,
      tab = focusedTab(layout),
      pane = layout.focused,
      target = sessionTarget(tab),
      file =
        getFiles().tabs.find(f => f.id === tab) ??
        getFiles().tabs.find(f => f.id === getPanelLayout(getPanelScope()).active),
      ref = workspace.ref
    const terminalId = terminal.activeId,
      projectId =
        ref?.projectId ??
        (ref?.sessionId ? getEngineState().sessions.find(s => s.record.id === ref.sessionId)?.record.projectId : null)
    const samePane = () =>
      !!findLeaf(getPaneState().layout.root, pane) &&
      getPaneState().layout.focused === pane &&
      focusedTab(getPaneState().layout) === tab
    const hasProject = () =>
      !!ref && (isDemo || (!!projectId && getEngineState().projects.some(p => p.id === projectId)))
    const hasFile = () => !!file && getFiles().tabs.some(f => f.id === file.id)
    const hasSession = () => !!target && !!sessionTarget(target.id)
    const items: CommandItem[] = []
    const add = (
      id: string,
      key: TranslationKey,
      category: TranslationKey,
      icon: LucideIcon,
      run: CommandItem['run'],
      shortcut?: string,
      valid?: () => boolean,
      reason?: string,
    ): void => {
      const words = allMessages[key]
      items.push({
        id,
        label: tr(key),
        keywords: words.zh + ' ' + words.en,
        category: tr(category),
        icon,
        run,
        shortcut,
        valid,
        reason: valid && !valid() ? (reason ?? t('palette.unavailable')) : undefined,
      })
    }
    add(
      'task.new',
      'palette.newTask',
      'terminal.categoryWorkbench',
      File,
      () => {
        paneActions.open(null)
      },
      undefined,
      samePane,
    )
    add('nav.workbench', 'nav.workbench', 'terminal.categoryWorkbench', LayoutDashboard, showWorkbench)
    add('nav.channels', 'nav.channels', 'terminal.categoryWorkbench', MessageSquare, () => setPage('channels'))
    add('inbox.open', 'projectTools.inbox.palette', 'terminal.categoryWorkbench', ListChecks, () =>
      openRightTab('tasks'),
    )
    add(
      'artifacts.open',
      'artifacts.palette',
      'terminal.categoryWorkbench',
      Package,
      () => openRightTab('artifacts'),
      undefined,
      hasProject,
      t('terminal.chooseProject'),
    )
    // Git（docs/ui/git-panel.md §6）
    add(
      'git.open',
      'git.palette.open',
      'terminal.categoryWorkbench',
      GitBranch,
      () => openRightTab('git'),
      undefined,
      hasProject,
      t('terminal.chooseProject'),
    )
    for (const [action, key] of [
      ['pull', 'git.palette.pull'],
      ['push', 'git.palette.push'],
      ['fetch', 'git.palette.fetch'],
      ['branch', 'git.palette.branch'],
    ] as const)
      add(
        'git.' + action,
        key,
        'terminal.categoryWorkbench',
        GitBranch,
        () => {
          openRightTab('git')
          requestGitAction(action)
        },
        undefined,
        hasProject,
        t('terminal.chooseProject'),
      )
    add('machines.switch', 'machines.switch', 'terminal.categoryWorkbench', TerminalSquare, openMachineManager)
    add('workspace.switch', 'machines.workspace', 'terminal.categoryWorkbench', FolderOpen, openWorkspacePicker)
    add('search.open', 'terminal.openSearch', 'terminal.categoryWorkbench', Search, openSearch, OPEN_SEARCH.label)
    add(
      'sidebar.toggle',
      'terminal.toggleSidebar',
      'terminal.categoryWorkbench',
      PanelLeft,
      () => {
        window.dispatchEvent(new CustomEvent('pixelsky:toggle-sidebar'))
      },
      TOGGLE_SIDEBAR.label,
    )
    add(
      'panel.toggle',
      'terminal.togglePanel',
      'terminal.categoryWorkbench',
      PanelRight,
      () => {
        window.dispatchEvent(new CustomEvent('pixelsky:toggle-panel'))
      },
      TOGGLE_PANEL.label,
    )
    add(
      'files.show',
      'palette.showFiles',
      'terminal.categoryWorkbench',
      FolderOpen,
      () => showFiles(ref!),
      undefined,
      hasProject,
      t('terminal.chooseProject'),
    )
    const size = () => {
      const r = document.querySelector('.pane-area')?.getBoundingClientRect()
      return { width: r?.width ?? 0, height: r?.height ?? 0 }
    }
    // 协作频道页时窗格不可见，窗格命令不可用（docs/ui/channels.md §2）
    const workbenchPane = () => getPage() === 'workbench' && samePane()
    add(
      'pane.right',
      'palette.splitRight',
      'palette.panes',
      Split,
      () => {
        const before = getPaneState().layout
        paneActions.split('row', size())
        return getPaneState().layout !== before
      },
      SPLIT_RIGHT.label,
      workbenchPane,
    )
    add(
      'pane.down',
      'palette.splitDown',
      'palette.panes',
      Split,
      () => {
        const before = getPaneState().layout
        paneActions.split('col', size())
        return getPaneState().layout !== before
      },
      SPLIT_DOWN.label,
      workbenchPane,
    )
    add(
      'pane.maximize',
      'palette.maximize',
      'palette.panes',
      Split,
      paneActions.toggleMaximize,
      ZOOM_PANE.label,
      workbenchPane,
    )
    add(
      'pane.close',
      'palette.closeTab',
      'palette.panes',
      X,
      async () => {
        if (tab) await paneActions.closeTab(pane, tab)
        return !findLeaf(getPaneState().layout.root, pane)?.tabs.includes(tab ?? '')
      },
      'Ctrl+W',
      () => workbenchPane() && !!tab,
    )
    add(
      'pane.next',
      'palette.nextPane',
      'palette.panes',
      PanelRight,
      () => paneActions.cycleFocus(1),
      'Ctrl+Alt+→',
      workbenchPane,
    )
    add(
      'file.save',
      'palette.saveFile',
      'palette.files',
      File,
      () => saveFile(file!.id),
      'Ctrl+S',
      () => hasFile() && file?.document?.kind === 'text' && !file.document.readonly,
      t('palette.noFile'),
    )
    add(
      'file.external',
      'palette.external',
      'palette.files',
      FolderOpen,
      async () => {
        if (isDemo) return false
        await window.pixelsky!.editor.open(file?.ref ?? ref!, undefined, file?.path)
      },
      undefined,
      hasProject,
      t('terminal.chooseProject'),
    )
    add(
      'file.folder',
      'palette.openFolder',
      'palette.files',
      FolderOpen,
      async () => {
        if (isDemo) return false
        await window.pixelsky!.files.reveal(ref!)
      },
      undefined,
      hasProject,
      t('terminal.chooseProject'),
    )
    add(
      'file.copyPath',
      'palette.copyPath',
      'palette.files',
      File,
      async () => {
        if (isDemo) return false
        await window.pixelsky!.files.copyPath(file!.ref, file!.path)
      },
      undefined,
      hasFile,
      t('palette.noFile'),
    )
    add(
      'session.rename',
      'session.rename',
      'palette.sessions',
      File,
      () => sessions.requestResult('rename', sessionTarget(target!.id)!),
      undefined,
      hasSession,
      t('palette.noSession'),
    )
    add(
      'session.bottom',
      target?.bottomed ? 'session.unbottom' : 'session.bottom',
      'palette.sessions',
      File,
      () => sessions.requestResult('bottom', sessionTarget(target!.id)!),
      undefined,
      hasSession,
      t('palette.noSession'),
    )
    add(
      'session.archive',
      target?.archived ? 'session.restore' : 'session.archive',
      'palette.sessions',
      File,
      () => sessions.requestResult(target!.archived ? 'restore' : 'archive', sessionTarget(target!.id)!),
      undefined,
      hasSession,
      t('palette.noSession'),
    )
    add(
      'session.delete',
      'session.delete',
      'palette.sessions',
      X,
      () => sessions.requestResult('delete', sessionTarget(target!.id)!),
      undefined,
      hasSession,
      t('palette.noSession'),
    )
    add(
      'terminal.toggle',
      terminal.open ? 'terminal.collapse' : 'terminal.expand',
      'terminal.categoryTerminal',
      TerminalSquare,
      terminal.toggle,
      'Ctrl+`',
    )
    add('terminal.focus', 'terminal.focus', 'terminal.categoryTerminal', TerminalSquare, terminal.focus)
    add(
      'terminal.new',
      'terminal.new',
      'terminal.categoryTerminal',
      TerminalSquare,
      () => terminal.create(ref),
      'Ctrl+Shift+`',
      hasProject,
      t('terminal.chooseProject'),
    )
    for (const action of ['rename', 'search', 'clear', 'restart', 'close'] as const)
      add(
        'terminal.' + action,
        ('terminal.' + action) as TranslationKey,
        'terminal.categoryTerminal',
        TerminalSquare,
        () => terminal.request(action, terminalId!),
        undefined,
        () => !!terminalId && terminalState().terminals.some(r => r.id === terminalId),
        t('terminal.noTerminals'),
      )
    for (const r of terminalState().terminals)
      items.push({
        id: 'terminal.select:' + r.id,
        label: t('palette.selectTerminal', { name: r.title }),
        keywords: r.title + ' ' + r.projectName + ' terminal 终端',
        category: t('terminal.title'),
        icon: TerminalSquare,
        valid: () => terminalState().terminals.some(v => v.id === r.id),
        run: () => terminal.select(r.id),
      })
    for (const [section, key] of [
      ['appearance', 'terminal.openAppearance'],
      ['plugins', 'terminal.openPlugins'],
      ['terminal', 'terminal.settings'],
      ['models', 'palette.models'],
      ['shortcuts', 'terminal.openShortcuts'],
      ['notifications', 'notifications.palette.open'],
    ] as const)
      add('settings.' + section, key, 'terminal.categorySettings', Settings, () =>
        settings.openSettings(section as SectionId),
      )
    add(
      'settings.open',
      'terminal.openSettings',
      'terminal.categorySettings',
      Settings,
      () => settings.openSettings(),
      'Ctrl+,',
    )
    // 勿扰（docs/ui/notifications.md §2）
    add('notifications.dndHour', 'notifications.palette.dndHour', 'terminal.categorySettings', Bell, () =>
      setNotificationPrefs({ dndUntil: Date.now() + 3600_000 }),
    )
    add(
      'notifications.dndOff',
      'notifications.dnd.end',
      'terminal.categorySettings',
      BellOff,
      () => setNotificationPrefs({ dndUntil: null }),
      undefined,
      () => {
        const until = getNotificationPrefs().dndUntil
        return until !== null && until > Date.now()
      },
    )
    for (const [mode, key] of [
      ['light', 'palette.light'],
      ['dark', 'palette.dark'],
      ['system', 'palette.system'],
    ] as const)
      add('theme.' + mode, key, 'terminal.categorySettings', Palette, () => theme.setPreference(mode))
    return items
  }
  const close = useCallback((restore = true): void => {
    setOpen(false)
    if (restore)
      requestAnimationFrame(() => {
        if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
      })
  }, [])
  const show = (): void => {
    if (
      executing.current ||
      document.querySelector('[aria-modal="true"]:not([data-global-search]):not([data-command-palette])')
    )
      return
    window.dispatchEvent(new Event('pixelsky:close-search-for-command'))
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCommands(build())
    setQuery('')
    setSelected(0)
    setRecent(history())
    setOpen(true)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.code === 'KeyP' && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && !e.repeat && !e.isComposing) {
        e.preventDefault()
        e.stopPropagation()
        show()
      }
    }
    const hide = () => close(false)
    window.addEventListener('keydown', key, true)
    window.addEventListener('pixelsky:close-command-for-search', hide)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pixelsky:close-command-for-search', hide)
    }
  })
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  const visible = rankCommands(commands, query, recent)
  const index = Math.min(selected, Math.max(0, visible.length - 1))
  useEffect(() => {
    const container = list.current,
      row = container?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!container || !row) return
    const a = container.getBoundingClientRect(),
      b = row.getBoundingClientRect()
    if (b.top < a.top) container.scrollTop += b.top - a.top
    else if (b.bottom > a.bottom) container.scrollTop += b.bottom - a.bottom
  }, [index, query, open])
  const execute = async (item: CommandItem | undefined): Promise<void> => {
    if (!item || item.reason || executing.current) return
    if (item.valid && !item.valid()) {
      toast(t('palette.changed'))
      return
    }
    executing.current = true
    flushSync(() => close(false))
    try {
      const result = await item.run()
      if (result !== false) {
        try {
          localStorage.setItem(
            HISTORY_KEY,
            JSON.stringify([item.id, ...history().filter(id => id !== item.id)].slice(0, 8)),
          )
        } catch {}
      }
    } catch (cause) {
      toast(translateMessage(cause instanceof Error ? cause.message : String(cause)))
    } finally {
      executing.current = false
    }
  }
  return (
    <Context.Provider value={{ open: show, isOpen: open }}>
      {children}
      {open &&
        createPortal(
          <div
            data-command-palette
            role="dialog"
            aria-modal="true"
            aria-label={t('terminal.commandPalette')}
            className="fixed inset-0 z-[75] flex items-start justify-center bg-scrim px-4 pt-[12vh]"
            onMouseDown={e => {
              if (e.target === e.currentTarget) close()
            }}
          >
            <div
              ref={popup}
              className="pop-in flex w-full max-w-[620px] flex-col overflow-hidden rounded-xl border border-line-card bg-popover text-fg shadow-popover"
              onKeyDown={e => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  close()
                }
                if (e.key === 'Tab') {
                  const first = input.current,
                    last = popup.current?.querySelector<HTMLButtonElement>('[data-close]')
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault()
                    last?.focus()
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault()
                    first?.focus()
                  }
                }
              }}
            >
              <label className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
                <Command size={17} className="shrink-0 text-fg-muted" />
                <input
                  ref={input}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="app-command-list"
                  aria-activedescendant={visible.length ? 'app-command-' + index : undefined}
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value)
                    setSelected(0)
                  }}
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing || (e.repeat && e.key === 'Enter')) return
                    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                      e.preventDefault()
                      setSelected(
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? visible.length - 1
                            : visible.length
                              ? (index + (e.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length
                              : 0,
                      )
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      void execute(visible[index])
                    }
                  }}
                  aria-label={t('terminal.commandPalette')}
                  placeholder={t('terminal.commandPlaceholder')}
                  className="min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-fg-faint"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button data-close aria-label={t('terminal.cancel')} onClick={() => close()} className="text-fg-muted">
                  <X size={15} />
                </button>
              </label>
              <div
                ref={list}
                id="app-command-list"
                role="listbox"
                className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1"
              >
                {!visible.length && (
                  <p className="px-3 py-5 text-center text-meta text-fg-muted">{t('terminal.noCommands')}</p>
                )}
                {visible.map((item, i) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      id={'app-command-' + i}
                      tabIndex={-1}
                      role="option"
                      aria-selected={i === index}
                      aria-disabled={!!item.reason}
                      title={item.reason}
                      data-command-id={item.id}
                      onMouseEnter={() => setSelected(i)}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => void execute(item)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left',
                        i === index ? 'bg-selected' : 'hover:bg-hover',
                        item.reason && 'opacity-50',
                      )}
                    >
                      <Icon size={16} className="shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui">{item.label}</span>
                        <span className="block truncate text-label text-fg-faint">
                          {item.reason ??
                            (recent.includes(item.id) && !query ? t('terminal.recent') + ' · ' : '') + item.category}
                        </span>
                      </span>
                      {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Context.Provider>
  )
}
export function useCommandPalette(): { open(): void; isOpen: boolean } {
  const value = useContext(Context)
  if (!value) throw new Error('CommandPaletteProvider missing')
  return value
}
