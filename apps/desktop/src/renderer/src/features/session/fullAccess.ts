// 完全放行的二次确认（docs/ui/full-access-confirm.md）：从别的模式切进完全放行时先在菜单里确认一次；
// 「以后不再提醒」存在本机（多窗口同步、进设置同步），设置 › 外观 › 对话里能打开回来
import { useSyncExternalStore } from 'react'
import type { PermissionMode } from '@pixelsky/protocol'

export const FULL_CONFIRM_SKIP_KEY = 'pixelsky.fullAccess.skipConfirm'

function read(): boolean {
  try {
    return localStorage.getItem(FULL_CONFIRM_SKIP_KEY) !== '1'
  } catch {
    return true
  }
}

let ask = typeof window === 'undefined' ? true : read()
const listeners = new Set<() => void>()

/** 切到完全放行前要不要确认（默认要） */
export function setFullAccessConfirm(next: boolean): void {
  if (next === ask) return
  ask = next
  // 演示模式只改内存，不覆盖真实设置
  if (!window.pixelsky?.demo)
    try {
      if (next) localStorage.removeItem(FULL_CONFIRM_SKIP_KEY)
      else localStorage.setItem(FULL_CONFIRM_SKIP_KEY, '1')
    } catch {
      /* 存储不可用时，本次仍然生效 */
    }
  listeners.forEach(fn => fn())
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', e => {
    if (e.storageArea !== localStorage || (e.key !== FULL_CONFIRM_SKIP_KEY && e.key !== null)) return
    const next = read()
    if (next === ask) return
    ask = next
    listeners.forEach(fn => fn())
  })

export function useFullAccessConfirm(): boolean {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => ask,
  )
}

/** 这次切换要不要先确认：只在从别的模式切进完全放行、又没关提醒时 */
export function needsFullConfirm(from: PermissionMode, to: PermissionMode, confirm: boolean): boolean {
  return confirm && to === 'full' && from !== 'full'
}

/** 「改回」用哪个模式：新会话的默认不是完全放行就用它，否则自动编辑（引擎不支持时每次询问） */
export function saferMode(defaultMode: PermissionMode | null | undefined, modes: PermissionMode[]): PermissionMode {
  if (defaultMode && defaultMode !== 'full' && modes.includes(defaultMode)) return defaultMode
  return modes.includes('edits') ? 'edits' : 'ask'
}
