import type { DiffBase, EditorViewMode } from '../types'

/** 中栏标签的纯逻辑：按项目分组，不碰 window / localStorage */
export interface CodeTabGroup {
  tabs: string[]
  active: string | null
}

export const EMPTY_GROUP: CodeTabGroup = { tabs: [], active: null }
/** 同时保留的编辑器实例上限（超出的按最近最少使用释放） */
export const EDITOR_CAP = 12

/** Git 对比标签的 id 前缀：不是文件，只在内存里（数据在 gitDiffTabs.ts），不写进持久化 */
export const GIT_DIFF_PREFIX = 'gitdiff:'
export const isGitDiffId = (id: string): boolean => id.startsWith(GIT_DIFF_PREFIX)

const isId = (value: unknown): value is string => typeof value === 'string' && value.startsWith('file:')

/** 读出保存的标签；坏数据逐项丢掉 */
export function parseCodeTabs(raw: unknown): Record<string, CodeTabGroup> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, CodeTabGroup> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const list = (value as { tabs?: unknown }).tabs
    if (!Array.isArray(list)) continue
    const tabs = [...new Set(list.filter(isId))]
    if (!tabs.length) continue
    const active = (value as { active?: unknown }).active
    out[key] = { tabs, active: isId(active) && tabs.includes(active) ? active : (tabs[0] ?? null) }
  }
  return out
}

/** 写进 localStorage 的内容：去掉 Git 对比标签（重启后不恢复），只剩对比标签的项目不存 */
export function persistable(groups: Record<string, CodeTabGroup>): Record<string, CodeTabGroup> {
  const out: Record<string, CodeTabGroup> = {}
  for (const [key, g] of Object.entries(groups)) {
    const tabs = g.tabs.filter(id => !isGitDiffId(id))
    if (!tabs.length) continue
    out[key] = { tabs, active: g.active && tabs.includes(g.active) ? g.active : (tabs[0] ?? null) }
  }
  return out
}

/** 把一个标签换成另一个（Git 对比的文件换了区）：位置不变；新 id 已经开着就只留那一个；换的是当前标签则新的成为当前 */
export function replaceInGroup(g: CodeTabGroup, from: string, to: string): CodeTabGroup {
  const index = g.tabs.indexOf(from)
  if (index < 0 || from === to) return g
  const active = g.active === from ? to : g.active
  if (g.tabs.includes(to)) return { tabs: g.tabs.filter(t => t !== from), active }
  const tabs = [...g.tabs]
  tabs[index] = to
  return { tabs, active }
}

/** 已有就激活，否则插到当前标签右边（没有当前标签就放最后） */
export function openInGroup(g: CodeTabGroup, id: string): CodeTabGroup {
  if (g.tabs.includes(id)) return g.active === id ? g : { tabs: g.tabs, active: id }
  const at = g.active ? g.tabs.indexOf(g.active) : -1
  const tabs = [...g.tabs]
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, id)
  return { tabs, active: id }
}

/** 关闭一个标签；关的是当前标签时激活右边那个，没有就左边 */
export function closeInGroup(g: CodeTabGroup, id: string): CodeTabGroup {
  const index = g.tabs.indexOf(id)
  if (index < 0) return g
  const tabs = g.tabs.filter(t => t !== id)
  const active = g.active === id ? (tabs[index] ?? tabs[index - 1] ?? null) : g.active
  return { tabs, active }
}

/** 在标签之间循环切换，到头了绕回另一头 */
export function cycleInGroup(g: CodeTabGroup, delta: 1 | -1): CodeTabGroup {
  if (g.tabs.length < 2) return g
  const at = g.active ? g.tabs.indexOf(g.active) : -1
  const next = at < 0 ? 0 : (at + delta + g.tabs.length) % g.tabs.length
  return { tabs: g.tabs, active: g.tabs[next] ?? g.active }
}

/**
 * 要释放哪些编辑器实例。order 从最久没用到最近用过；当前标签和有未保存改动的不释放；
 * 超出 cap 多少就释放多少（最久的先），释放不够时也不强行释放那两类
 */
export function lruToRelease(
  order: string[],
  active: string | null,
  dirty: ReadonlySet<string>,
  cap: number,
): string[] {
  const excess = order.length - cap
  if (excess <= 0) return []
  return order.filter(id => id !== active && !dirty.has(id)).slice(0, excess)
}

export interface CodeTabsState {
  projectKey: string
  group: CodeTabGroup
  views: Record<string, { mode: EditorViewMode; base: DiffBase }>
}

/** 路径比较用的归一化：Windows 本机不分大小写 */
export const pathKey = (path: string, caseInsensitive: boolean): string => {
  const p = path.replaceAll('\\', '/').replace(/^\.\//, '')
  return caseInsensitive ? p.toLowerCase() : p
}

/** 文件名（最后一段） */
export const baseName = (path: string): string => path.replaceAll('\\', '/').split('/').pop() ?? path
