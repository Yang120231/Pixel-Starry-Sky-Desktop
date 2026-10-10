// 自动更新状态（docs/release-update.md §7）：主进程推送，这里只订阅一次、全应用共用
import { useSyncExternalStore } from 'react'
import type { UpdateState } from '../../../../shared/types/update'

let state: UpdateState | null = null
let started = false
const listeners = new Set<() => void>()
const emit = (next: UpdateState): void => {
  state = next
  for (const l of listeners) l()
}

function start(): void {
  if (started) return
  started = true
  const bridge = window.pixelsky?.update
  if (!bridge) return
  bridge.onChange(emit)
  bridge.state().then(emit, () => undefined)
}

const subscribe = (l: () => void): (() => void) => {
  start()
  listeners.add(l)
  return () => listeners.delete(l)
}

/** 当前更新状态；没有桥（浏览器预览）时为 null */
export function useUpdateState(): UpdateState | null {
  return useSyncExternalStore(subscribe, () => state)
}

/** 调用主进程；返回新状态的调用顺手更新本地状态（推送也会到，这里只是更快） */
export const updateActions = {
  check: () => window.pixelsky?.update.check().then(emit),
  install: () => window.pixelsky?.update.install(),
  download: () => window.pixelsky?.update.download(),
  setBeta: (beta: boolean) => window.pixelsky?.update.setBeta(beta).then(emit),
}
