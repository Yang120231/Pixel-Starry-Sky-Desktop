import { useEffect, useState, useSyncExternalStore } from 'react'
import { IGNORED_STATUS } from '../../../../shared/types/workspace'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { refKey } from './treeDrag'

// 被 .gitignore 忽略的文件：files:status 里状态码为 'I' 的路径（主进程 workspace-files.ts gitIgnored）。
// 文件树里变暗 / 可隐藏，Ctrl+P / 搜索里排在后面。docs/ui/file-tree-icons.md §2。

export { IGNORED_STATUS }

/** files:status 的结果拆成「改动」和「被忽略」两份：改动照旧上色，被忽略的不能算成改动（文件夹的「•」也不能因它而出现） */
export function splitStatuses(all: Record<string, string>): { changes: Record<string, string>; ignored: Set<string> } {
  const changes: Record<string, string> = {}
  const ignored = new Set<string>()
  for (const [path, status] of Object.entries(all)) {
    if (status === IGNORED_STATUS) ignored.add(path)
    else changes[path] = status
  }
  return { changes, ignored }
}

/** 自己或任一层上级（按 '/' 切；多文件夹项目的 '::N/…' 同理）在被忽略的集合里；'' 永远不算 */
export function isIgnoredPath(path: string, ignored: ReadonlySet<string>): boolean {
  if (!path || ignored.size === 0) return false
  if (ignored.has(path)) return true
  for (let i = path.indexOf('/'); i > 0; i = path.indexOf('/', i + 1)) {
    if (ignored.has(path.slice(0, i))) return true
  }
  return false
}

/** Ctrl+P / 搜索：被忽略的排到后面，其余顺序不变 */
export function partitionIgnored<T>(items: T[], path: (t: T) => string, ignored: ReadonlySet<string>): T[] {
  if (ignored.size === 0) return items
  const normal: T[] = []
  const dimmed: T[] = []
  for (const item of items) (isIgnoredPath(path(item), ignored) ? dimmed : normal).push(item)
  return dimmed.length ? [...normal, ...dimmed] : items
}

// ---- 「隐藏被忽略的文件」：按根目录路径记（项目、会话文件树、附加文件夹都一样）----
export const HIDE_IGNORED_KEY = 'pixelsky.files.hideIgnored'

const currentPlatform = (): string =>
  typeof window !== 'undefined' && window.pixelsky?.platform
    ? String(window.pixelsky.platform)
    : typeof process !== 'undefined'
      ? process.platform
      : ''

/** key = 根目录绝对路径（斜杠统一、去结尾斜杠；Windows / macOS 不分大小写，转小写） */
export function hideIgnoredKey(rootPath: string, platform: string = currentPlatform()): string {
  const p = rootPath.replaceAll('\\', '/').replace(/\/+$/, '')
  return platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p
}

const hideListeners = new Set<() => void>()
let hideCache: { raw: string | null; map: Record<string, true> } | null = null

function readHideMap(): Record<string, true> {
  let raw: string | null = null
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(HIDE_IGNORED_KEY)
  } catch {
    /* 读不了当作没设置 */
  }
  // 同一份原文返回同一个对象，useSyncExternalStore 才不会反复重画
  if (hideCache && hideCache.raw === raw) return hideCache.map
  let map: Record<string, true> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) if (v === true) map[k] = true
    }
  } catch {
    map = {}
  }
  hideCache = { raw, map }
  return map
}

function subscribeHide(listener: () => void): () => void {
  hideListeners.add(listener)
  const onStorage = (e: StorageEvent): void => {
    if (e.key === HIDE_IGNORED_KEY || e.key === null) listener()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    hideListeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export function setHideIgnored(rootPath: string, value: boolean): void {
  const key = hideIgnoredKey(rootPath)
  const next = { ...readHideMap() }
  if (value) next[key] = true
  else delete next[key]
  try {
    localStorage.setItem(HIDE_IGNORED_KEY, JSON.stringify(next))
  } catch {
    /* 存不了就只在本次运行里不变 */
  }
  for (const l of [...hideListeners]) l()
}

/** 整张表（文件树标题栏的「⋯」要列出每个根的开关） */
export function useHideIgnoredMap(): Record<string, true> {
  return useSyncExternalStore(subscribeHide, readHideMap, () => ({}))
}

export function isHidingIgnored(map: Record<string, true>, rootPath: string | null): boolean {
  return !!rootPath && !!map[hideIgnoredKey(rootPath)]
}

// ---- Ctrl+P / 搜索：按 WorkspaceRef 取被忽略的集合，缓存 10 秒 ----
const IGNORED_TTL_MS = 10_000
const EMPTY: ReadonlySet<string> = new Set()
const fetched = new Map<string, { at: number; set: ReadonlySet<string> }>()
const inflight = new Map<string, Promise<ReadonlySet<string>>>()

function loadIgnored(ref: WorkspaceRef): Promise<ReadonlySet<string>> {
  const key = refKey(ref)
  const hit = fetched.get(key)
  if (hit && Date.now() - hit.at < IGNORED_TTL_MS) return Promise.resolve(hit.set)
  const running = inflight.get(key)
  if (running) return running
  const files = typeof window === 'undefined' ? undefined : window.pixelsky?.files
  const job = (files ? files.status(ref) : Promise.resolve({} as Record<string, string>))
    .then(all => splitStatuses(all).ignored as ReadonlySet<string>)
    .catch(() => EMPTY)
    .then(set => {
      fetched.set(key, { at: Date.now(), set })
      if (fetched.size > 20) fetched.delete(fetched.keys().next().value as string)
      return set
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

/** 读取中 / 出错 / 没有 ref 时是空集合（什么都不变暗） */
export function useIgnoredSet(ref: WorkspaceRef | null): ReadonlySet<string> {
  const key = ref ? refKey(ref) : null
  const [set, setSet] = useState<ReadonlySet<string>>(() => (key ? (fetched.get(key)?.set ?? EMPTY) : EMPTY))
  useEffect(() => {
    if (!ref || !key) {
      setSet(EMPTY)
      return
    }
    let cancelled = false
    setSet(fetched.get(key)?.set ?? EMPTY)
    void loadIgnored(ref).then(s => {
      if (!cancelled) setSet(s)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref 的内容由 key 代表
  }, [key])
  return set
}
