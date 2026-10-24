// 平台额度的扣费 Key 开关（docs/ui/platform-key-mode.md）：自动（客户端专用的托管 Key，默认）/ 我的 Key。
// 模式存在主进程（平台请求都带上它）；切换后重读线路目录，线路上的 Key 标签跟着变。演示模式只改内存。
import { useEffect, useSyncExternalStore } from 'react'
import type { PlatformKeyMode } from '../../../../shared/types/platform-catalog'
import { reloadPlatformKeys } from './platform'

interface KeyModeState {
  mode: PlatformKeyMode
  saving: boolean
  error: string | null
}

let state: KeyModeState = { mode: 'auto', saving: false, error: null }
const listeners = new Set<() => void>()
let started = false

function set(patch: Partial<KeyModeState>): void {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

function start(): void {
  if (started) return
  started = true
  const bridge = window.pixelsky?.platformCatalog
  if (!bridge || window.pixelsky?.demo) return
  const read = (reload: boolean): void =>
    void bridge
      .keyMode()
      .then(mode => {
        if (mode === state.mode || state.saving) return
        set({ mode })
        if (reload) reloadPlatformKeys(mode)
      })
      .catch(() => undefined)
  read(false)
  // 设置云同步会在别的窗口里把模式写回主进程：回到这个窗口时再读一次，变了就重读线路（标签跟着变）
  window.addEventListener('focus', () => read(true))
}

export async function setKeyMode(mode: PlatformKeyMode): Promise<void> {
  if (mode === state.mode || state.saving) return
  const previous = state.mode
  set({ mode, error: null })
  if (window.pixelsky?.demo) {
    reloadPlatformKeys(mode)
    return
  }
  const bridge = window.pixelsky?.platformCatalog
  if (!bridge) return
  set({ saving: true })
  try {
    set({ mode: await bridge.setKeyMode(mode) })
    reloadPlatformKeys(mode)
  } catch (e) {
    set({ mode: previous, error: (e as Error).message })
  } finally {
    set({ saving: false })
  }
}

export function useKeyMode(): KeyModeState {
  useEffect(start, [])
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}
