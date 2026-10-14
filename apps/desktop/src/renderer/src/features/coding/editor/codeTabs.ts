import { useSyncExternalStore } from 'react'
import { isDemo } from '@/data'
import { releaseEditor } from '@/features/editor/code/CodeEditor'
import { confirmFiles } from '@/features/files/FileConfirm'
import { dirtyFile, ensureFile, getFiles, removeFile } from '@/features/files/store'
import { showWorkbench } from '@/features/layout/page'
import { panelFileIds } from '@/features/panel/workspaceStore'
import { recordRecentFile } from '@/features/panel/recentFiles'
import { getPaneState } from '@/features/panes/store'
import { leaves } from '@/features/panes/tree'
import type { DiffBase, EditorViewMode } from '../types'
import {
  EDITOR_CAP,
  EMPTY_GROUP,
  closeInGroup,
  cycleInGroup,
  lruToRelease,
  openInGroup,
  isGitDiffId,
  parseCodeTabs,
  persistable,
  replaceInGroup,
  type CodeTabGroup,
  type CodeTabsState,
} from './codeTabsModel'

export const CODE_TABS_KEY = isDemo ? 'pixelsky.coding.tabs.v1.demo' : 'pixelsky.coding.tabs.v1'

let groups: Record<string, CodeTabGroup> = {}
try {
  groups = parseCodeTabs(JSON.parse(localStorage.getItem(CODE_TABS_KEY) ?? '{}'))
} catch {
  /* 坏数据从空标签开始 */
}
const views: CodeTabsState['views'] = {}
/** 最近用过的标签，最久的在前；只用来决定释放哪个编辑器实例 */
let order: string[] = []
let projectKey = ''
let state: CodeTabsState = { projectKey, group: EMPTY_GROUP, views }
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(CODE_TABS_KEY, JSON.stringify(persistable(groups)))
  } catch {
    /* 没有持久化也能用 */
  }
}

function publish(): void {
  state = { projectKey, group: groups[projectKey] ?? EMPTY_GROUP, views: { ...views } }
  listeners.forEach(fn => fn())
}

function setGroup(next: CodeTabGroup): void {
  if (next.tabs.length) groups = { ...groups, [projectKey]: next }
  else groups = Object.fromEntries(Object.entries(groups).filter(([key]) => key !== projectKey))
  persist()
  publish()
}

export function useCodeTabs(): CodeTabsState {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => state,
  )
}
export const getCodeTabs = (): CodeTabsState => state

/** 当前项目换了：切到它的标签组，并把恢复出来的文件读进来 */
export function setCodeProject(key: string): void {
  if (key === projectKey) return
  projectKey = key
  publish()
  for (const id of groups[key]?.tabs ?? []) if (!isGitDiffId(id)) void ensureFile(id).catch(() => {})
}

/** 用掉一个编辑器名额后，超出上限的按最近最少使用释放 */
function touch(id: string): void {
  if (isGitDiffId(id)) return
  order = [...order.filter(x => x !== id), id]
  const dirty = new Set(
    getFiles()
      .tabs.filter(dirtyFile)
      .map(t => t.id),
  )
  const drop = lruToRelease(order, id, dirty, EDITOR_CAP)
  for (const gone of drop) releaseEditor(gone)
  if (drop.length) order = order.filter(x => !drop.includes(x))
}

/** 注册成 code opener：openFile 的结果落到中栏 */
export function openCodeTab(id: string): void {
  setGroup(openInGroup(groups[projectKey] ?? EMPTY_GROUP, id))
  recordRecentFile(projectKey, id)
  touch(id)
  showWorkbench()
}

export function activateCodeTab(id: string): void {
  const group = groups[projectKey] ?? EMPTY_GROUP
  if (!group.tabs.includes(id) || group.active === id) return
  setGroup({ tabs: group.tabs, active: id })
  if (!isGitDiffId(id)) recordRecentFile(projectKey, id)
  touch(id)
}

export function cycleCodeTab(delta: 1 | -1): void {
  const group = groups[projectKey] ?? EMPTY_GROUP
  const next = cycleInGroup(group, delta)
  if (next.active && next.active !== group.active) activateCodeTab(next.active)
}

/** 关闭一个标签；有未保存改动时先问；返回是否真的关了 */
export async function closeCodeTab(id: string): Promise<boolean> {
  if (!(await confirmFiles([id]))) return false
  const group = groups[projectKey] ?? EMPTY_GROUP
  if (group.tabs.includes(id)) {
    const next = closeInGroup(group, id)
    setGroup(next)
    if (next.active && next.active !== group.active) touch(next.active)
  }
  order = order.filter(x => x !== id)
  delete views[id]
  const stillUsed =
    panelFileIds().includes(id) ||
    leaves(getPaneState().layout.root).some(leaf => leaf.tabs.includes(id)) ||
    Object.values(groups).some(g => g.tabs.includes(id))
  if (!stillUsed && !isGitDiffId(id)) removeFile(id)
  publish()
  return true
}

export function setCodeView(id: string, mode: EditorViewMode, base?: DiffBase): void {
  views[id] = { mode, base: base ?? views[id]?.base ?? 'head' }
  publish()
}

/** 打开 / 激活一个非文件标签（Git 对比）：不进最近文件，也不占编辑器名额 */
export function openPseudoTab(id: string): void {
  setGroup(openInGroup(groups[projectKey] ?? EMPTY_GROUP, id))
  showWorkbench()
}

/** 当前项目里把一个非文件标签换成另一个（Git 对比的文件换了区） */
export function replaceCodeTab(from: string, to: string): void {
  const group = groups[projectKey]
  if (group) setGroup(replaceInGroup(group, from, to))
}

/** 所有项目里开着的标签 id（清理 Git 对比的数据用） */
export const allCodeTabIds = (): Set<string> => new Set(Object.values(groups).flatMap(g => g.tabs))
