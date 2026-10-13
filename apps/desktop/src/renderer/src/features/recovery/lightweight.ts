// 轻量模式（docs/ui/renderer-memory.md §3.1.4）：崩溃后重新加载的这一次，对话只显示最近 20 轮、切走的对话标签不保留。
// 只在内存里，本次加载有效，不改用户设置；刷新页面就回到设置里的值。
import { useSyncExternalStore } from 'react'
import { DEFAULT_KEEP_ALIVE, setKeepAliveLimit } from '@/features/panes/keepAlive'
import { recovered } from './recovered'

export { capTurns } from './turns'

let on = recovered !== null
if (on) setKeepAliveLimit(0)
const listeners = new Set<() => void>()

export const isLightweight = (): boolean => on

/** 退出轻量模式：恢复成设置里的轮数和保活 2 个；已经打开的对话不会把已显示的再藏回去 */
export function leaveLightweight(): void {
  if (!on) return
  on = false
  setKeepAliveLimit(DEFAULT_KEEP_ALIVE)
  listeners.forEach(l => l())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useLightweight = (): boolean => useSyncExternalStore(subscribe, isLightweight, () => false)
