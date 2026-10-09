import { createContext, useContext } from 'react'

/** 顶栏工具挪到侧栏后也要知道右侧面板状态；顶栏自己用 props 覆盖，侧栏用 App 提供的值。 */
export interface ToolbarState {
  panelOpen: boolean
  filesPanelOpen?: boolean
  onCloseFiles?: () => void
}

export const ToolbarContext = createContext<ToolbarState>({ panelOpen: false })

export function useToolbarState(): ToolbarState {
  return useContext(ToolbarContext)
}
