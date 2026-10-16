import { useSyncExternalStore } from 'react'
import type {
  ExtStoreCatalogPage,
  ExtStoreCatalogQuery,
  ExtStoreSort,
  ExtStoreState,
  ExtStoreUpdates,
} from '@pixelsky/protocol'
import { demo, isDemo } from '@/data/demo'
import { translateMessage } from '@/i18n/core'
import { extstoreBridge } from './bridge'
import { EMPTY_STORE_STATE, UPDATE_CHECK_INTERVAL_MS, installToast, type InstallToast } from './storeModel'

// 扩展商店状态的单例（方案 §2）：第一次用到时才去主进程取，之后跟着 extstore:changed 刷新。
// 导入时不做任何事（没有监听、没有请求、不碰 window / document），node 环境的测试可以放心 import。
// 同一份里还放了发现页的浏览位置（搜索词、分类、排序、已取的页、滚动位置），页签卸载或点进详情再回来时接着看。

/** 打开扩展页时至少隔这么久才再让主进程读一次停用名单（主进程自己也按 5 分钟节流，这里省一次 IPC） */
const BLOCKLIST_TOUCH_MS = 5 * 60_000

export interface ExtStoreSnapshot {
  /** 主进程的商店状态（站点、更新、停用名单时间、进行中的安装） */
  state: ExtStoreState
  /** 上次检查更新是不是还在进行 */
  checking: boolean
  /** 最近一次检查更新成功的时间（毫秒）；没查过是 null */
  updatesAt: number | null
  /** 每个扩展最近一次安装失败的提示（已翻成当前语言），再点安装时清掉 */
  installErrors: Readonly<Record<string, string>>
}

const listeners = new Set<() => void>()
let snapshot: ExtStoreSnapshot = { state: EMPTY_STORE_STATE, checking: false, updatesAt: null, installErrors: {} }
let started = false
let inflight: Promise<void> | null = null
let lastBlocklistTouch = 0

/** 界面用的桥：演示模式给一个自己带数据的假桥，否则是主进程的 window.pixelsky.extstore */
function api(): ReturnType<typeof extstoreBridge> {
  if (isDemo) return demo().extStore.bridge
  return extstoreBridge()
}

function set(patch: Partial<ExtStoreSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const l of [...listeners]) l()
}

/** 重新取商店状态；取的过程中又来了通知：等这一轮结束再取一次，避免拿到旧状态 */
export function refreshExtStore(): Promise<void> {
  const b = api()
  if (!b) return Promise.resolve()
  if (inflight) return inflight.then(() => refreshExtStore())
  inflight = b
    .state()
    .then(next => {
      set({ state: next })
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** 让主进程读一次停用名单（距上次不到 5 分钟就不调：主进程自己也按 5 分钟节流，这里省一次 IPC）；失败不打扰用户 */
export function touchBlocklist(now: number = Date.now()): void {
  const b = api()
  if (!b || now - lastBlocklistTouch < BLOCKLIST_TOUCH_MS) return
  lastBlocklistTouch = now
  void b
    .refreshBlocklist()
    .then(r => {
      if (r.blocklistAt !== snapshot.state.blocklistAt)
        set({ state: { ...snapshot.state, blocklistAt: r.blocklistAt } })
    })
    .catch(() => {})
}

/** 距上次检查更新超过 10 分钟（或还没查过）才查 */
export function touchUpdates(now: number = Date.now()): void {
  if (!api()) return
  if (snapshot.updatesAt === null || now - snapshot.updatesAt >= UPDATE_CHECK_INTERVAL_MS) void checkExtUpdates()
}

/** 打开扩展页时调：读停用名单，超过 10 分钟没查过更新就查一次 */
export function touchExtStore(now: number = Date.now()): void {
  start()
  touchBlocklist(now)
  touchUpdates(now)
}

/** 点「检查更新」或打开页面时自动查；同时只查一次 */
export async function checkExtUpdates(): Promise<ExtStoreUpdates> {
  const b = api()
  if (!b) return {}
  if (snapshot.checking) return snapshot.state.updates
  set({ checking: true })
  try {
    const updates = await b.checkUpdates()
    set({ state: { ...snapshot.state, updates }, updatesAt: Date.now(), checking: false })
    return updates
  } catch {
    set({ checking: false })
    return snapshot.state.updates
  }
}

function start(): void {
  if (started) return
  const b = api()
  if (!b) return
  started = true
  b.onChange(() => void refreshExtStore())
  void refreshExtStore()
  touchBlocklist()
}

/** 第一次调用会触发取状态、订阅变化，并让主进程读一次停用名单；取到之前是空状态 */
export function getExtStore(): ExtStoreSnapshot {
  start()
  return snapshot
}

export function subscribeExtStore(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useExtStore(): ExtStoreSnapshot {
  return useSyncExternalStore(subscribeExtStore, getExtStore, getExtStore)
}

// 安装结束的提示：状态单例里算出来，由挂在应用根上的 ExtStoreToastHost 弹（单例本身不碰界面）
const toastListeners = new Set<(t: InstallToast) => void>()
const itemNames = new Map<string, string>()

export function subscribeInstallToasts(listener: (t: InstallToast) => void): () => void {
  toastListeners.add(listener)
  return () => {
    toastListeners.delete(listener)
  }
}

export interface InstallOptions {
  /** 不弹「已安装」提示（别处代为安装时用） */
  silent?: boolean
  /** 提示里用的名字；不给就用目录里见过的名字，再没有就用 id */
  name?: string
  /** 'update' 包含换回 */
  kind?: 'install' | 'update'
}

/** 装 / 更新：进度由 extstore:changed 推送，这里只管发起、记下失败原因和发提示 */
export async function installExtension(id: string, version: string, options: InstallOptions = {}): Promise<boolean> {
  const b = api()
  if (!b) return false
  if (snapshot.installErrors[id]) set({ installErrors: withoutKey(snapshot.installErrors, id) })
  const base = { id, name: options.name ?? itemNames.get(id), kind: options.kind, silent: options.silent }
  const emitToast = (r: Parameters<typeof installToast>[0]): void => {
    const toast = installToast(r)
    if (toast) for (const l of [...toastListeners]) l(toast)
  }
  try {
    await b.install(id, version)
    void refreshExtStore()
    emitToast({ ...base, ok: true })
    return true
  } catch (e) {
    const raw = (e as Error)?.message ?? String(e)
    const reason = translateMessage(raw)
    set({ installErrors: { ...snapshot.installErrors, [id]: reason } })
    void refreshExtStore()
    emitToast({ ...base, ok: false, reason, cancelled: /extstore\.cancelled/.test(raw) })
    return false
  }
}

export async function cancelInstall(id: string): Promise<void> {
  try {
    await api()?.cancel(id)
  } catch {
    /* 取消不了就等它自己结束 */
  }
}

function withoutKey<T>(map: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _drop, ...rest } = map
  return rest
}

/** 目录请求（发现页用）：没有桥时当作连不上 */
export function fetchCatalog(query: ExtStoreCatalogQuery): Promise<ExtStoreCatalogPage> {
  const b = api()
  if (!b) return Promise.reject(new Error('extstore unavailable'))
  return b.catalog(query).then(page => {
    for (const item of page.items) itemNames.set(item.id, item.name)
    return page
  })
}

// ---- 发现页的浏览位置 ----

export interface DiscoverView {
  q: string
  category: string
  sort: ExtStoreSort
  /** 已取的几页（从第一页起，按顺序） */
  pages: ExtStoreCatalogPage[]
  scrollTop: number
}

export const DEFAULT_DISCOVER_VIEW: DiscoverView = {
  q: '',
  category: 'all',
  sort: 'recommended',
  pages: [],
  scrollTop: 0,
}

let view: DiscoverView = DEFAULT_DISCOVER_VIEW

/** 发现页卸载（切页签、点进详情）时存下，挂载时取回 */
export function saveDiscoverView(next: DiscoverView): void {
  view = { ...next, pages: [...next.pages] }
}

export function discoverView(): DiscoverView {
  return view
}
