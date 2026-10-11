// 窗口不在前台时在 <html> 上标 data-window-idle，globals.css 据此暂停循环动画（docs/ui/performance.md）。
// 前台与否以主进程推来的窗口焦点为准（焦点进了内置浏览器的网页视图时窗口仍算在前台）；
// 没有主进程（网页预览）时用页面自己的 focus / blur。最小化、收进托盘时页面也是隐藏的。

/** 现在是否算「窗口不在前台」 */
export const windowIdle = (focused: boolean, hidden: boolean): boolean => hidden || !focused

export function startWindowActivity(): void {
  const root = document.documentElement
  let focused = document.hasFocus()
  const apply = (): void => {
    if (windowIdle(focused, document.hidden)) root.dataset.windowIdle = ''
    else delete root.dataset.windowIdle
  }
  const bridge = window.pixelsky?.window
  if (bridge) {
    bridge.onState(state => {
      focused = state.focused
      apply()
    })
    void bridge
      .getState()
      .then(state => {
        focused = state.focused
        apply()
      })
      .catch(() => {})
  } else {
    window.addEventListener('focus', () => {
      focused = true
      apply()
    })
    window.addEventListener('blur', () => {
      focused = false
      apply()
    })
  }
  document.addEventListener('visibilitychange', apply)
  apply()
}
