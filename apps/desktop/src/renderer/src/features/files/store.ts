import { machineOf } from '@/features/machines/store'
import { tr } from '../../i18n/core'
import { useSyncExternalStore } from 'react'
import type { FileDocument, WorkspaceRef } from '../../../../shared/types/workspace'
import { isDemo, projects } from '@/data'
import { paneActions } from '@/features/panes/store'
import { getEngineState } from '@/features/engine/store'
import { fileTab, parseFileTab } from '@/features/panes/tree'
import {
  getPanelScope,
  openRightTab,
  detachPanelFile,
  replacePanelFile,
  panelFileIds,
  resolvePanelFileId,
} from '@/features/panel/workspaceStore'
import { demo } from '@/data/demo'

export const OPEN_FILES_EVENT = 'pixelsky:open-files'
export const FILE_CLOSED_EVENT = 'pixelsky:file-closed'
export interface OpenFile {
  preview?: boolean
  id: string
  ref: WorkspaceRef
  path: string
  name: string
  root: string
  project: string
  document: FileDocument | null
  draft: string
  cursor: { line: number; column: number }
  reveal: { line: number; column: number; seq: number } | null
  head: string | null
  external: FileDocument | null
  ignoredVersion: string | null
  changed: number
  loading: boolean
  saving: boolean
  error: string | null
}
interface State {
  tabs: OpenFile[]
  active: string | null
}
let state: State = { tabs: [], active: null }
const listeners = new Set<() => void>()
const checking = new Set<string>()
function set(next: State): void {
  state = next
  listeners.forEach(l => l())
}
export function useFiles(): State {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}
export const getFiles = (): State => state
/** 删除会话前把文件 API 目标改为长期存在的项目；当前标签 id 不变，保留 EditorView 与草稿。 */
export function retainSessionFiles(sessionId: string): void {
  const affected = state.tabs.filter(tab => tab.ref.sessionId === sessionId)
  const stored = panelFileIds().filter(id => parseFileTab(resolvePanelFileId(id))?.ref.sessionId === sessionId)
  if (!affected.length && !stored.length) return
  const engine = getEngineState(),
    record = engine.snapshots[sessionId]?.record ?? engine.sessions.find(s => s.record.id === sessionId)?.record
  const project = engine.projects.find(
    p => record && p.id === record.projectId && p.path.toLowerCase() === record.cwd.toLowerCase(),
  )
  if (!project) throw new Error('先保存并关闭这个会话打开的文件，再删除会话')
  set({
    ...state,
    tabs: state.tabs.map(tab => (tab.ref.sessionId === sessionId ? { ...tab, ref: { projectId: project.id } } : tab)),
  })
  for (const tab of affected) replacePanelFile(tab.id, fileTab({ projectId: project.id }, tab.path))
  for (const id of stored) replacePanelFile(id, fileTab({ projectId: project.id }, parseFileTab(id)!.path))
}
const sameRef = (a: WorkspaceRef, b: WorkspaceRef): boolean =>
  a.projectId === b.projectId && a.sessionId === b.sessionId
/** path 本身或它下面的文件（文件夹改名 / 删除时一起处理） */
const under = (path: string, base: string): boolean => path === base || path.startsWith(base + '/')

/** 已打开的、位于 path（文件或文件夹）下的文件（docs/ui/files-search-terminal-pins.md §3） */
export const openFilesUnder = (ref: WorkspaceRef, path: string): OpenFile[] =>
  state.tabs.filter(tab => sameRef(tab.ref, ref) && under(tab.path, path))

/**
 * 文件树重命名 / 移动后，已打开的标签换成新路径。标签 id 不变，保留编辑器和草稿；
 * 保存的布局记新 id，重启后按新路径打开（和 retainSessionFiles 同样的做法）。
 */
export function renameOpenFiles(ref: WorkspaceRef, from: string, to: string): void {
  let changed = false
  const tabs = state.tabs.map(tab => {
    if (!sameRef(tab.ref, ref) || !under(tab.path, from)) return tab
    changed = true
    const path = to + tab.path.slice(from.length)
    replacePanelFile(tab.id, fileTab(tab.ref, path))
    return { ...tab, path, name: path.split('/').pop() ?? path }
  })
  if (changed) set({ ...state, tabs })
}

export const dirtyFile = (tab: OpenFile): boolean =>
  tab.document?.kind === 'text' && tab.draft !== tab.document.content.replace(/\r\n/g, '\n')
export const updateFile = (id: string, patch: Partial<OpenFile>): void =>
  set({ ...state, tabs: state.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)) })
export function showFiles(ref?: WorkspaceRef, path?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_FILES_EVENT, { detail: { ref, path } }))
}
export const activateFile = (id: string): void => {
  if (state.active !== id) set({ ...state, active: id })
}
export function removeFile(id: string): void {
  detachPanelFile(id)
  const index = state.tabs.findIndex(t => t.id === id),
    tabs = state.tabs.filter(t => t.id !== id)
  set({ tabs, active: state.active === id ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : state.active })
  window.dispatchEvent(new CustomEvent(FILE_CLOSED_EVENT, { detail: id }))
}
export async function loadFile(id: string): Promise<void> {
  const tab = state.tabs.find(t => t.id === id)
  if (!tab) return
  updateFile(id, { loading: true, error: null })
  try {
    const document = isDemo ? demo().files.document(tab.path) : await window.pixelsky!.files.read(tab.ref, tab.path)
    updateFile(id, {
      document,
      draft: document.kind === 'text' ? document.content.replace(/\r\n/g, '\n') : '',
      external: null,
      ignoredVersion: null,
      loading: false,
    })
    if (document.kind === 'text' && !document.readonly) {
      const head = isDemo
        ? document.content.replace(/\r\n/g, '\n')
        : await window.pixelsky!.files.headContent(tab.ref, tab.path).catch(() => null)
      updateFile(id, { head })
    } else updateFile(id, { head: null })
  } catch (e) {
    updateFile(id, { error: (e as Error).message, loading: false })
  }
}
export async function ensureFile(id: string): Promise<void> {
  if (state.tabs.some(t => t.id === id)) return
  const parsed = parseFileTab(resolvePanelFileId(id))
  if (!parsed) return
  const { ref, path } = parsed
  const tab: OpenFile = {
    id,
    ref,
    path,
    root: '',
    project: '',
    name: path.split('/').pop() ?? path,
    document: null,
    draft: '',
    cursor: { line: 1, column: 1 },
    reveal: null,
    head: null,
    external: null,
    ignoredVersion: null,
    changed: 0,
    loading: true,
    saving: false,
    error: null,
  }
  set({ ...state, tabs: [...state.tabs, tab] })
  if (isDemo) {
    const project = projects.find(p => p.id === ref.projectId || p.sessions.some(s => s.id === ref.sessionId))
    updateFile(id, { root: project?.name ?? '', project: project?.name ?? '' })
  } else {
    try {
      const target = await window.pixelsky!.files.target(ref)
      updateFile(id, { root: target.path.replaceAll('\\', '/'), project: target.name })
    } catch {
      /* loadFile 提供实际错误 */
    }
  }
  await loadFile(id)
}
export async function openFile(
  ref: WorkspaceRef,
  path: string,
  line?: number,
  column = 1,
  searchText?: string,
): Promise<void> {
  const panelScope = getPanelScope()
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  const demoProject = isDemo
    ? projects.find(p => p.id === ref.projectId || p.sessions.some(s => s.id === ref.sessionId))
    : null
  const target = isDemo
    ? { name: demoProject?.name ?? '', path: demoProject?.id ?? ref.projectId ?? ref.sessionId ?? '' }
    : await window.pixelsky!.files.target(ref)
  const machine = machineOf(ref.projectId ?? ref.sessionId),
    windows = machine === 'local' && window.pixelsky?.platform === 'win32'
  const root = target.path.replaceAll('\\', '/'),
    key = windows ? root.toLowerCase() : root
  const existing = state.tabs.find(
    t =>
      machineOf(t.ref.projectId ?? t.ref.sessionId) === machine &&
      (windows ? t.root.toLowerCase() : t.root) === key &&
      (windows ? t.path.toLowerCase() === normalized.toLowerCase() : t.path === normalized),
  )
  if (!isDemo && 'ref' in target) ref = target.ref
  const id = existing?.id ?? fileTab(ref, normalized)
  const loading = ensureFile(id)
  updateFile(id, { root, project: target.name })
  await loading
  const current = state.tabs.find(t => t.id === id)
  if (searchText && current?.document?.kind === 'text') {
    const index = current.draft.indexOf(searchText.replace(/\r\n/g, '\n'))
    line = index >= 0 ? current.draft.slice(0, index).split('\n').length : 1
  }
  updateFile(id, {
    reveal: { line: Math.max(1, line ?? 1), column: Math.max(1, column), seq: (current?.reveal?.seq ?? 0) + 1 },
  })
  paneActions.detachFileTab(id)
  openRightTab(id, panelScope)
  activateFile(id)
}
export async function checkFile(id: string): Promise<void> {
  const tab = state.tabs.find(t => t.id === id)
  if (isDemo || !tab?.document || tab.loading || tab.saving || checking.has(id)) return
  checking.add(id)
  try {
    const next = await window.pixelsky!.files.read(tab.ref, tab.path),
      now = state.tabs.find(t => t.id === id)
    if (
      !now ||
      now.loading ||
      now.saving ||
      now.document?.kind !== 'text' ||
      (next.kind === 'text' && next.version === now.document.version)
    )
      return
    if (dirtyFile(now)) {
      if (next.kind !== 'text' || next.version !== now.ignoredVersion) updateFile(id, { external: next })
    } else
      updateFile(id, {
        document: next,
        draft: next.kind === 'text' ? next.content.replace(/\r\n/g, '\n') : '',
        external: null,
        changed: now.changed + 1,
        error: null,
      })
  } catch (e) {
    updateFile(id, { error: (e as Error).message })
  } finally {
    checking.delete(id)
  }
}
export const checkOpenFiles = (): void => {
  for (const tab of state.tabs) void checkFile(tab.id)
}
export async function saveFile(id: string): Promise<boolean> {
  const tab = state.tabs.find(t => t.id === id)
  if (!tab || tab.document?.kind !== 'text' || tab.document.readonly || tab.saving || tab.loading) return false
  if (!dirtyFile(tab)) return true
  updateFile(id, { saving: true, error: null })
  try {
    if (isDemo) throw new Error(tr('files.store.demoModeCannotSave'))
    const document = await window.pixelsky!.files.save(tab.ref, tab.path, tab.draft, tab.document.version)
    // 保存期间还可输入；只更新基线，不覆盖更晚的草稿。
    updateFile(id, { document, external: null, ignoredVersion: null, saving: false })
    return true
  } catch (e) {
    updateFile(id, { error: (e as Error).message, saving: false })
    void checkFile(id)
    return false
  }
}
export const hasDirtyFiles = (): boolean => state.tabs.some(dirtyFile)
