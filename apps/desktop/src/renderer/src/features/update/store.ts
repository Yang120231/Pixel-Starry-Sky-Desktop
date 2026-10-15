// 自动更新状态（docs/release-update.md §7）：主进程推送，这里只订阅一次、全应用共用
import { useSyncExternalStore } from 'react'
import type { UpdateState } from '../../../../shared/types/update'

let state: UpdateState | null = null
let started = false
// 「稍后」按版本记在本次运行的内存里，切换模式或重新挂载提示不会清掉。
const dismissedVersions = new Set<string>()
const listeners = new Set<() => void>()
const notify = (): void => {
  for (const l of listeners) l()
}
const emit = (next: UpdateState): void => {
  state = next
  notify()
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

/** 两种模式共用的提示状态；关于页仍能查看被暂时关闭的更新。 */
export function useUpdateNoticeState(): UpdateState | null {
  return useSyncExternalStore(subscribe, () => {
    if (!state?.version || (state.status !== 'ready' && state.status !== 'available')) return null
    return dismissedVersions.has(state.version) ? null : state
  })
}

/** 调用主进程；返回新状态的调用顺手更新本地状态（推送也会到，这里只是更快） */
export const updateActions = {
  dismissNotice: (version: string): void => {
    dismissedVersions.add(version)
    notify()
  },
  check: () => window.pixelsky?.update.check().then(emit),
  install: () => window.pixelsky?.update.install(),
  download: () => window.pixelsky?.update.download(),
  setBeta: (beta: boolean) => window.pixelsky?.update.setBeta(beta).then(emit),
}
