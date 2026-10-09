import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useActiveWorkspace } from '@/editor/target'
import { getEngineState } from '@/engine/store'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { isDemo, projects } from '@/mock/data'
import type { WorkspaceRef } from '../../../shared/types/workspace'
import {
  initTerminalStore,
  terminalClose,
  terminalCreate,
  terminalError,
  terminalRename,
  terminalRestart,
  terminalState,
  useTerminalStore,
} from './store'
import { screens } from './screens'
import { openRightTab } from '@/components/panel/workspaceStore'
import { workspaceTerminals } from './workspace'
import { getMachines, machineOf, selectMachine } from '@/machines/store'
import { getPage, showWorkbench } from '@/layout/page'

type Action = 'rename' | 'close' | 'restart' | 'search' | 'clear'
interface TerminalUi {
  workspacePath: string
  open: boolean
  maximized: boolean
  activeId: string | null
  projectId: string | null
  height: number
  toggle(): void
  reveal(openDock?: boolean): void
  focus(): void
  toggleMaximize(): void
  select(id: string): void
  selectProject(id: string): void
  setHeight(value: number): void
  create(ref?: WorkspaceRef | null, profileId?: string): Promise<boolean>
  request(action: Action, id?: string): Promise<boolean>
  paste(id: string, text: string): void
  searchId: string | null
  stopSearch(): void
}
interface Dialog {
  kind: 'rename' | 'close' | 'restart' | 'paste'
  id: string
  value: string
  generation: number
  resolve: (ok: boolean) => void
}
const Context = createContext<TerminalUi | null>(null)
const key = isDemo ? 'pixelsky.terminal.ui.demo' : 'pixelsky.terminal.ui'
function read(): { open: boolean; projectId: string | null; activeId: string | null; height: number } {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}')
    return {
      open: v.open === true,
      projectId: typeof v.projectId === 'string' ? v.projectId : null,
      activeId: typeof v.activeId === 'string' ? v.activeId : null,
      height: typeof v.height === 'number' ? Math.max(160, Math.min(620, v.height)) : 280,
    }
  } catch {
    return { open: false, projectId: null, activeId: null, height: 280 }
  }
}
export function TerminalProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n(),
    workspace = useActiveWorkspace(),
    state = useTerminalStore()
  const [ui, setUi] = useState(read),
    [maximized, setMaximized] = useState(false),
    [searchId, setSearch] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [value, setValue] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const creating = useRef(false),
    returning = useRef<HTMLElement | null>(null)
  const projectOf = (ref: WorkspaceRef | null): string | null => {
    if (!ref) return null
    if (ref.projectId) return ref.projectId
    if (isDemo) return projects.find(p => p.sessions.some(s => s.id === ref.sessionId))?.id ?? null
    const engine = getEngineState()
    return (
      engine.snapshots[ref.sessionId!]?.record.projectId ??
      engine.sessions.find(s => s.record.id === ref.sessionId)?.record.projectId ??
      null
    )
  }
  useEffect(() => {
    void initTerminalStore()
  }, [])
  useEffect(() => {
    const projectId = projectOf(workspace.ref)
    const items = workspaceTerminals(state.terminals, projectId, workspace.path, window.pixelsky?.platform === 'win32')
    setUi(v => ({
      ...v,
      projectId,
      activeId: items.some(t => t.id === v.activeId) ? v.activeId : (items[0]?.id ?? null),
    }))
  }, [workspace.path, workspace.ref?.projectId, workspace.ref?.sessionId])
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(ui))
    } catch {}
  }, [ui])
  useEffect(() => {
    if (!state.ready) return
    if (!ui.activeId || !state.terminals.some(r => r.id === ui.activeId)) {
      const next =
        workspaceTerminals(
          state.terminals,
          ui.projectId,
          projectOf(workspace.ref) === ui.projectId ? workspace.path : '',
          window.pixelsky?.platform === 'win32',
        )[0]?.id ?? null
      if (ui.activeId !== next) setUi(v => ({ ...v, activeId: next }))
    }
    if (!ui.projectId && workspace.ref) setUi(v => ({ ...v, projectId: projectOf(workspace.ref) }))
  }, [state.ready, state.terminals, ui.projectId, ui.activeId, workspace.key])
  const select = useCallback((id: string): void => {
    const r = terminalState().terminals.find(r => r.id === id)
    if (!r) return
    const machine = machineOf(r.projectId)
    if (machine !== getMachines().currentId) {
      void selectMachine(machine)
        .then(() => select(id))
        .catch(terminalError)
      return
    }
    setUi(v => ({ ...v, activeId: id, projectId: r.projectId, open: true }))
    openRightTab('terminal')
    requestAnimationFrame(() => screens.get(id)?.focus())
  }, [])
  const create = async (
    ref: WorkspaceRef | null = workspace.ref && projectOf(workspace.ref) === ui.projectId
      ? workspace.ref
      : ui.projectId
        ? { projectId: ui.projectId }
        : workspace.ref,
    profileId?: string,
  ): Promise<boolean> => {
    if (creating.current) return false
    if (!ref) {
      terminalError(new Error(t('terminal.chooseProject')))
      setUi(v => ({ ...v, open: true }))
      return false
    }
    creating.current = true
    terminalError(null)
    try {
      const record = await terminalCreate(ref, profileId)
      select(record.id)
      return record.status === 'running'
    } catch (cause) {
      terminalError(cause)
      return false
    } finally {
      creating.current = false
    }
  }
  const reveal = (openDock = true): void => {
    if (openDock) openRightTab('terminal')
    setUi(v => ({ ...v, open: true }))
    if (ui.activeId) requestAnimationFrame(() => screens.get(ui.activeId!)?.focus())
  }
  const toggle = (): void => {
    if (ui.open) {
      setUi(v => ({ ...v, open: false }))
      setMaximized(false)
      window.dispatchEvent(new Event('pixelsky:hide-terminal'))
      requestAnimationFrame(() => {
        if (returning.current?.isConnected) returning.current.focus({ preventScroll: true })
      })
      return
    }
    returning.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const projectId = ui.projectId ?? projectOf(workspace.ref)
    setUi(v => ({ ...v, projectId, open: true }))
    openRightTab('terminal')
    const existing =
      state.terminals.find(r => r.id === ui.activeId) ??
      workspaceTerminals(
        state.terminals,
        projectId,
        projectOf(workspace.ref) === projectId ? workspace.path : '',
        window.pixelsky?.platform === 'win32',
      )[0]
    if (existing) select(existing.id)
    else if (projectId && state.ready)
      void create(workspace.ref && projectOf(workspace.ref) === projectId ? workspace.ref : { projectId })
  }
  const focus = (): void => {
    if (!ui.open) toggle()
    else if (ui.activeId) screens.get(ui.activeId)?.focus()
  }
  const request = async (kind: Action, id = ui.activeId ?? ''): Promise<boolean> => {
    const record = terminalState().terminals.find(r => r.id === id)
    if (!record || dialog) return false
    if (kind === 'clear') {
      screens.get(id)?.clear()
      return true
    }
    if (kind === 'search') {
      setUi(v => ({ ...v, activeId: id, projectId: record.projectId, open: true }))
      setSearch(id)
      openRightTab('terminal')
      return true
    }
    if ((kind === 'close' || kind === 'restart') && !['running', 'starting'].includes(record.status)) {
      try {
        if (kind === 'close') await terminalClose(id)
        else {
          await terminalRestart(id)
          select(id)
        }
        return true
      } catch (cause) {
        terminalError(cause)
        return false
      }
    }
    return new Promise<boolean>(resolve => {
      setValue(record.title)
      setError(null)
      setDialog({ kind, id, value: record.title, generation: record.generation, resolve })
    })
  }
  const paste = (id: string, text: string): void => {
    const record = terminalState().terminals.find(r => r.id === id)
    if (!record || record.status !== 'running') return
    if (text.length > 256 * 1024) {
      terminalError(new Error(t('terminal.inputLimit')))
      return
    }
    if (/[\r\n]/.test(text)) {
      if (!dialog) {
        setError(null)
        setDialog({ kind: 'paste', id, value: text, generation: record.generation, resolve: () => {} })
      }
    } else screens.get(id)?.paste(text)
  }
  const finish = (ok: boolean): void => {
    dialog?.resolve(ok)
    setDialog(null)
    setBusy(false)
    setError(null)
    if (dialog) requestAnimationFrame(() => screens.get(dialog.id)?.focus())
  }
  const confirm = async (): Promise<void> => {
    if (!dialog || busy) return
    setBusy(true)
    setError(null)
    try {
      const record = terminalState().terminals.find(r => r.id === dialog.id)
      if (!record) throw new Error(t('terminal.missing'))
      if (dialog.kind === 'rename') {
        if (!value.trim() || [...value.trim()].length > 120 || /[\u0000-\u001f\u007f]/.test(value))
          throw new Error(t('terminal.invalidTitle'))
        await terminalRename(dialog.id, value.trim())
      } else if (dialog.kind === 'paste') {
        if (record.generation !== dialog.generation || record.status !== 'running')
          throw new Error(t('terminal.changed'))
        screens.get(dialog.id)?.paste(dialog.value)
      } else {
        if (record.generation !== dialog.generation) throw new Error(t('terminal.changed'))
        if (dialog.kind === 'close') await terminalClose(dialog.id, true)
        else await terminalRestart(dialog.id, true)
      }
      finish(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        event.code !== 'Backquote' ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.repeat ||
        event.isComposing ||
        document.querySelector('[aria-modal="true"]')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey)
        void create(
          document.activeElement?.closest('[data-terminal-input]') && ui.projectId
            ? { projectId: ui.projectId }
            : workspace.ref,
        )
      // 协作频道页时终端不可见：切回工作台显示它，而不是悄悄收起
      else if (ui.open && getPage() !== 'workbench') {
        showWorkbench()
        reveal()
      } else toggle()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  const context: TerminalUi = {
    ...ui,
    workspacePath: projectOf(workspace.ref) === ui.projectId ? workspace.path : '',
    maximized,
    toggle,
    reveal,
    focus,
    select,
    create,
    request,
    paste,
    searchId,
    stopSearch: () => {
      if (searchId) {
        screens.get(searchId)?.endSearch()
        screens.get(searchId)?.focus()
      }
      setSearch(null)
    },
    toggleMaximize: () => {
      setUi(v => ({ ...v, open: true }))
      setMaximized(v => !v)
    },
    setHeight: height => setUi(v => ({ ...v, height })),
    selectProject: id => {
      setUi(v => ({ ...v, projectId: id, activeId: state.terminals.find(r => r.projectId === id)?.id ?? null }))
    },
  }
  return (
    <Context.Provider value={context}>
      {children}
      {dialog && (
        <ConfirmDialog
          title={t(
            dialog.kind === 'rename'
              ? 'terminal.rename'
              : dialog.kind === 'paste'
                ? 'terminal.pasteTitle'
                : dialog.kind === 'restart'
                  ? 'terminal.restartTitle'
                  : 'terminal.closeRunningTitle',
          )}
          description={
            dialog.kind === 'rename' ? (
              <input
                aria-label={t('terminal.renamePrompt')}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void confirm()
                  }
                }}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ui text-fg outline-none focus:border-accent"
              />
            ) : dialog.kind === 'paste' ? (
              <>
                <p>{t('terminal.pasteHint')}</p>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-subtle p-3 text-meta">
                  {dialog.value}
                </pre>
              </>
            ) : (
              t('terminal.closeRunningDescription')
            )
          }
          confirmLabel={t(
            dialog.kind === 'rename'
              ? 'terminal.save'
              : dialog.kind === 'paste'
                ? 'terminal.paste'
                : dialog.kind === 'restart'
                  ? 'terminal.restart'
                  : 'terminal.close',
          )}
          cancelLabel={t('terminal.cancel')}
          busy={busy}
          error={error}
          danger={dialog.kind === 'close' || dialog.kind === 'restart'}
          focusInput={dialog.kind === 'rename'}
          onConfirm={() => void confirm()}
          onCancel={() => finish(false)}
        />
      )}
    </Context.Provider>
  )
}
export function useTerminalUi(): TerminalUi {
  const value = useContext(Context)
  if (!value) throw new Error('TerminalProvider missing')
  return value
}
