export interface WindowState {
  maximized: boolean
  focused: boolean
  snapped: boolean
}

export type WindowSnapLayout =
  | 'columns-2'
  | 'columns-3'
  | 'large-left'
  | 'large-right'
  | 'grid-4'
  | 'wide-center'

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
