import { useSyncExternalStore } from 'react'
import type { ExtPackContributionKind, ExtPackInfo, ExtPackState } from '@pixelsky/protocol'
import { assetUrl, contributionsFrom, EMPTY_PACK_STATE, type ContributionRef } from './model'

// 扩展包状态的单例：第一次用到时才去主进程取，之后跟着 extpacks:changed 刷新。
// 导入时不做任何事（没有监听、没有请求、不碰 window / document），node 环境的测试可以放心 import。

const listeners = new Set<() => void>()
let state: ExtPackState = EMPTY_PACK_STATE
let started = false
let inflight: Promise<void> | null = null

const bridge = () => (typeof window === 'undefined' ? undefined : window.pixelsky?.extpacks)

function emit(): void {
  for (const l of [...listeners]) l()
}

export function refreshPacks(): Promise<void> {
  const b = bridge()
  if (!b) return Promise.resolve()
  // 取的过程中又来了通知：等这一轮结束再取一次，避免拿到旧状态
  if (inflight) return inflight.then(() => refreshPacks())
  inflight = b
    .state()
    .then(next => {
      state = next
      emit()
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

function start(): void {
  if (started) return
  const b = bridge()
  if (!b) return
  started = true
  b.onChange(() => void refreshPacks())
  void refreshPacks()
}

/** 第一次调用会触发取状态并订阅变化；取到之前是空状态（loading） */
export function getPackState(): ExtPackState {
  start()
  return state
}

export function subscribePacks(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePackState(): ExtPackState {
  return useSyncExternalStore(subscribePacks, getPackState, getPackState)
}

export function usePacksRevision(): number {
  return usePackState().revision
}

export function packByKey(key: string): ExtPackInfo | undefined {
  return getPackState().packs.find(p => p.key === key)
}

export function contributionsOf<K extends ExtPackContributionKind>(kind: K): Array<ContributionRef<K>> {
  return contributionsFrom(getPackState(), kind)
}

const CACHE_MAX = 64
const jsonCache = new Map<string, Promise<unknown>>()
const textCache = new Map<string, Promise<string>>()

function cached<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  path: string,
  load: (key: string, path: string) => Promise<T>,
): Promise<T> {
  const id = `${key}@${packByKey(key)?.revision ?? 0}:${path}`
  const hit = cache.get(id)
  if (hit) return hit
  const promise = load(key, path)
  cache.set(id, promise)
  // 失败的不留，下次重试；超过上限丢最早的
  promise.catch(() => {
    if (cache.get(id) === promise) cache.delete(id)
  })
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return promise
}

export function readPackJson(key: string, path: string): Promise<unknown> {
  const b = bridge()
  if (!b) return Promise.reject(new Error('extpacks unavailable'))
  return cached(jsonCache, key, path, (k, p) => b.readJson(k, p))
}

export function readPackText(key: string, path: string): Promise<string> {
  const b = bridge()
  if (!b) return Promise.reject(new Error('extpacks unavailable'))
  return cached(textCache, key, path, (k, p) => b.readText(k, p))
}

/** 资源地址（带当前扩展版本，重新加载后浏览器缓存自然失效） */
export function packAssetUrl(key: string, path: string): string {
  return assetUrl(key, path, packByKey(key)?.revision ?? 0)
}

export function uiTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

const themeListeners = new Set<() => void>()
let observer: MutationObserver | null = null

/** 界面深 / 浅色切换（<html data-theme>）；MutationObserver 在第一次订阅时才创建 */
export function onUiThemeChange(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const l of [...themeListeners]) l()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  themeListeners.add(listener)
  return () => {
    themeListeners.delete(listener)
  }
}
