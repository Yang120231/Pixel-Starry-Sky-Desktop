// 「对话 | 代码」切换动画（docs/ui/mode-transition.md）：设置的读写，和用 View Transitions 包一次切换。
// 动画本身写在 styles/modeTransition.css：<html data-mode-vt="slide|fade" data-mode-dir="toCode|toChat"> 只在播放期间存在
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { MODE_TRANSITION_KEY, parseModeTransition, transitionFor, type ModeTransition } from './modeTransitionModel'

function read(): ModeTransition {
  try {
    return parseModeTransition(window.localStorage.getItem(MODE_TRANSITION_KEY))
  } catch {
    return parseModeTransition(null)
  }
}

let choice: ModeTransition = typeof window === 'undefined' ? parseModeTransition(null) : read()
const listeners = new Set<() => void>()

export function setModeTransition(next: ModeTransition): void {
  choice = parseModeTransition(next)
  try {
    window.localStorage.setItem(MODE_TRANSITION_KEY, choice)
  } catch {
    // 存储不可用时只在内存里生效
  }
  listeners.forEach(fn => fn())
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // 别的窗口改了、或云同步写进来
  window.addEventListener('storage', e => {
    if (e.key !== MODE_TRANSITION_KEY && e.key !== null) return
    choice = read()
    listeners.forEach(fn => fn())
  })
}

export function useModeTransition(): ModeTransition {
  return useSyncExternalStore(
    subscribe,
    () => choice,
    () => choice,
  )
}

let running: ViewTransition | null = null

/** 切换模式：能播动画就把 update 包进一次 View Transition（同步渲染完新布局再截图），否则直接切 */
export function runModeTransition(update: () => void, dir: 'toCode' | 'toChat'): void {
  if (typeof document === 'undefined') {
    update()
    return
  }
  const root = document.documentElement
  const kind = transitionFor(
    choice,
    root.dataset.motion,
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    typeof document.startViewTransition === 'function',
  )
  // 上一次还没播完又切：跳到结尾再开始这次，免得两次叠在一起
  running?.skipTransition()
  if (!kind) {
    update()
    return
  }
  root.dataset.modeVt = kind
  root.dataset.modeDir = dir
  const transition = document.startViewTransition(() => flushSync(update))
  running = transition
  void transition.finished.finally(() => {
    if (running !== transition) return
    running = null
    delete root.dataset.modeVt
    delete root.dataset.modeDir
  })
}
