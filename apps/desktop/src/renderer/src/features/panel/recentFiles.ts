// 右侧工作区「最近文件」（docs/ui/right-workspace-tools.md §2.2）：按工作区作用域分开，只存文件标签 id 和时间。
// 存在本机 localStorage，读写失败不影响使用；默认界面不预置任何记录。
import { useSyncExternalStore } from 'react'
import { isDemo } from '@/data'
import { isFileTab } from '../panes/tree'

export const RECENT_LIMIT = 8
const KEY = isDemo ? 'pixelsky.right-workspace.recent.demo.v1' : 'pixelsky.right-workspace.recent.v1'
/** 最多记多少个作用域，旧的先丢 */
const SCOPE_LIMIT = 50

export interface RecentFile {
  /** 文件标签 id（file:…），里面带着项目 / 会话和路径 */
  id: string
  at: number
}

/** 读出保存的数据；坏数据丢掉，不抛错 */
export function parseRecent(raw: unknown): Record<string, RecentFile[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, RecentFile[]> = {}
  for (const [scope, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    const items = list.filter((item): item is RecentFile => {
      const ok =
        !!item &&
        typeof item.id === 'string' &&
        isFileTab(item.id) &&
        typeof item.at === 'number' &&
        Number.isFinite(item.at) &&
        !seen.has(item.id)
      if (ok) seen.add(item.id)
      return ok
    })
    if (items.length) out[scope] = items.slice(0, RECENT_LIMIT)
  }
  return out
}

/** 把一个文件放到最前面：去重，最多 RECENT_LIMIT 个 */
export function pushRecent(list: readonly RecentFile[], id: string, at: number): RecentFile[] {
  return [{ id, at }, ...list.filter(item => item.id !== id)].slice(0, RECENT_LIMIT)
}

let recent: Record<string, RecentFile[]> = {}
try {
  recent = parseRecent(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
} catch {
  /* 坏数据从空列表开始 */
}
const listeners = new Set<() => void>()
const EMPTY: RecentFile[] = []

export function recordRecentFile(scope: string, id: string, at = Date.now()): void {
  if (!scope || !isFileTab(id)) return
  if (recent[scope]?.[0]?.id === id) return
  const rest = Object.entries(recent).filter(([key]) => key !== scope)
  recent = Object.fromEntries([[scope, pushRecent(recent[scope] ?? EMPTY, id, at)], ...rest.slice(0, SCOPE_LIMIT - 1)])
  try {
    localStorage.setItem(KEY, JSON.stringify(recent))
  } catch {
    /* 没有持久化也能用 */
  }
  listeners.forEach(fn => fn())
}

export function useRecentFiles(scope: string): RecentFile[] {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => recent[scope] ?? EMPTY,
  )
}
