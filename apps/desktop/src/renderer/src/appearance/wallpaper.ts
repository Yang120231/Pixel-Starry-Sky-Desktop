import { tr } from '../i18n/core'
// 壁纸：图片 / 视频铺满窗口，上面盖一层主题底色保证可读。规格见 docs/ui/settings.md §6（参考 Mirasim「背景」扩展）。
// 文件存在 IndexedDB，设置存在 localStorage，只在本机生效。
import { useSyncExternalStore } from 'react'

export type WallpaperKind = 'image' | 'video'

export interface WallpaperPrefs {
  /** 文件名，空字符串表示没有壁纸 */
  name: string
  kind: WallpaperKind
  /** 背景透出程度 0.1–0.9 */
  show: number
  /** 背景模糊 0–20px */
  blur: number
}

export interface WallpaperState extends WallpaperPrefs {
  /** 当前壁纸的 blob: 地址，没有壁纸或还在读取时为 null */
  url: string | null
}

export const MAX_WALLPAPER_BYTES = 200 * 1024 * 1024
export const WALLPAPER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm'

const KEY = 'pixelsky.wallpaper'
const DB = 'pixelsky-wallpaper'
const FILE_KEY = 'current'
const DEFAULT_PREFS: WallpaperPrefs = { name: '', kind: 'image', show: 0.45, blur: 0 }

function loadPrefs(): WallpaperPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<WallpaperPrefs>
    return {
      name: typeof saved.name === 'string' ? saved.name : '',
      kind: saved.kind === 'video' ? 'video' : 'image',
      show: clamp(Number(saved.show ?? DEFAULT_PREFS.show), 0.1, 0.9),
      blur: clamp(Number(saved.blur ?? 0), 0, 20),
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

/* ---------- IndexedDB ---------- */

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('files', mode)
      const req = fn(tx.objectStore('files'))
      tx.oncomplete = () => {
        db.close()
        resolve(req ? req.result : undefined)
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

/* ---------- 状态 ---------- */

let state: WallpaperState = { ...loadPrefs(), url: null }
const listeners = new Set<() => void>()

function emit(next: WallpaperState): void {
  state = next
  const { url: _url, ...prefs } = next
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 忽略
  }
  applyRoot()
  listeners.forEach(l => l())
}

/** tokens.css 据 data-wallpaper 透出壁纸；Windows 自绘按钮透明，其他平台同步原生覆盖层。 */
function applyRoot(): void {
  const root = document.documentElement
  const on = !!state.name
  if (on) root.dataset.wallpaper = state.kind
  else delete root.dataset.wallpaper
  const theme = root.dataset.theme === 'dark' ? 'dark' : 'light'
  window.pixelsky?.setTheme(theme, on)
}

/** 当前是否有壁纸（ThemeProvider 同步其他平台原生覆盖层时使用） */
export function hasWallpaper(): boolean {
  return !!state.name
}

// 启动时：记录过壁纸就先把底色设透明（避免先闪一下纯色），再从 IndexedDB 读文件
if (state.name) {
  document.documentElement.dataset.wallpaper = state.kind
  void withStore<Blob>('readonly', s => s.get(FILE_KEY) as IDBRequest<Blob>)
    .then(blob => {
      if (blob) emit({ ...state, url: URL.createObjectURL(blob) })
      else emit({ ...state, name: '', url: null })
    })
    .catch(() => emit({ ...state, name: '', url: null }))
}

export function getWallpaper(): WallpaperState {
  return state
}

/** 选择新壁纸。返回错误信息（中文），成功返回 null */
export async function setWallpaperFile(file: File): Promise<string | null> {
  const kind: WallpaperKind | null = file.type.startsWith('video/')
    ? 'video'
    : file.type.startsWith('image/')
      ? 'image'
      : null
  if (!kind) return tr('appearance.wallpaper.message22')
  if (file.size > MAX_WALLPAPER_BYTES) return tr('appearance.wallpaper.message23')
  try {
    await withStore('readwrite', s => s.put(file, FILE_KEY))
  } catch {
    return tr('appearance.wallpaper.message24')
  }
  if (state.url) URL.revokeObjectURL(state.url)
  emit({ ...state, name: file.name, kind, url: URL.createObjectURL(file) })
  return null
}

export async function removeWallpaper(): Promise<void> {
  if (state.url) URL.revokeObjectURL(state.url)
  emit({ ...state, name: '', url: null })
  try {
    await withStore('readwrite', s => s.delete(FILE_KEY))
  } catch {
    // 忽略：下次选择新壁纸会覆盖
  }
}

export function setWallpaperPrefs(patch: Partial<Pick<WallpaperPrefs, 'show' | 'blur'>>): void {
  emit({
    ...state,
    show: patch.show === undefined ? state.show : clamp(patch.show, 0.1, 0.9),
    blur: patch.blur === undefined ? state.blur : clamp(patch.blur, 0, 20),
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWallpaper(): WallpaperState {
  return useSyncExternalStore(subscribe, getWallpaper)
}
