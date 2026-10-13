import { useSyncExternalStore } from 'react'
import { parseAppMode } from './layoutModel'
import type { AppMode } from './types'
import { runModeTransition } from './modeTransition'

const demo = typeof window !== 'undefined' && window.pixelsky?.demo === true
/** 演示模式用 'pixelsky.app-mode.demo'（docs/ui/coding-mode-impl.md D6） */
export const APP_MODE_KEY = demo ? 'pixelsky.app-mode.demo' : 'pixelsky.app-mode'

const parse = parseAppMode

function read(): AppMode {
  if (typeof window === 'undefined') return 'chat'
  try {
    return parse(window.localStorage.getItem(APP_MODE_KEY))
  } catch {
    return 'chat'
  }
}

function reflect(mode: AppMode): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.appMode = mode
}

let current: AppMode = read()
reflect(current)
const listeners = new Set<() => void>()

function apply(mode: AppMode): void {
  if (mode === current) return
  current = mode
  reflect(mode)
  listeners.forEach(fn => fn())
}

export function getAppMode(): AppMode {
  return current
}

export function setAppMode(mode: AppMode): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(APP_MODE_KEY, mode)
    } catch {
      // 存储不可用时只在内存里生效
    }
  }
  if (mode === current) return
  // 切换布局时按设置播动画（modeTransition.ts）；别的窗口改了模式（storage 事件）不播
  runModeTransition(() => apply(mode), mode === 'code' ? 'toCode' : 'toChat')
}

export function subscribeAppMode(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // 另一个窗口改了模式时跟着变
  window.addEventListener('storage', e => {
    if (e.key === APP_MODE_KEY) apply(parse(e.newValue))
  })
}

export function useAppMode(): AppMode {
  return useSyncExternalStore(subscribeAppMode, getAppMode, getAppMode)
}
