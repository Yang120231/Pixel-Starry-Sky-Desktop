/** 窗格焦点提示只控制选择变化，不改变窗格拆分 / 关闭动画。 */
export type PaneFocusMotion = 'flash' | 'slide' | 'none'
export const PANE_FOCUS_MOTION_KEY = 'pixelsky.paneFocusMotion'
export const DEFAULT_PANE_FOCUS_MOTION: PaneFocusMotion = 'flash'

export function parsePaneFocusMotion(value: unknown): PaneFocusMotion {
  return value === 'flash' || value === 'slide' || value === 'none' ? value : DEFAULT_PANE_FOCUS_MOTION
}

export function readPaneFocusMotion(): PaneFocusMotion {
  try {
    return parsePaneFocusMotion(localStorage.getItem(PANE_FOCUS_MOTION_KEY))
  } catch {
    return DEFAULT_PANE_FOCUS_MOTION
  }
}
