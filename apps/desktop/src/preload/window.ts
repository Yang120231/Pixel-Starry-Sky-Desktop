import type { WindowState, WindowSnapLayout } from '../shared/types/window'

/** 仅操作发起调用的应用窗口。 */
export interface WindowBridge {
  getState: () => Promise<WindowState>
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  snap: (layout: WindowSnapLayout, zone: number) => Promise<void>
  snapOptions: () => Promise<Record<WindowSnapLayout, boolean[]>>
  restoreSnap: () => Promise<void>
  close: () => Promise<void>
  onState: (cb: (state: WindowState) => void) => () => void
}
