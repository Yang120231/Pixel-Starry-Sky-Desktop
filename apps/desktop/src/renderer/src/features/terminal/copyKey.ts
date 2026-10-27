type KeyLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

/**
 * 终端里这次按键是不是「复制」（docs/ui/terminal-command-palette.md）：Ctrl/⌘+Shift+C 一直是；
 * Windows / Linux 上有选中内容时 Ctrl+C 也是（和 Windows Terminal、VS Code 一样），没有选中时 Ctrl+C 照旧交给 Shell 中断。
 * macOS 的 Ctrl+C 永远是中断，复制用 ⌘C。
 */
export function isCopyKey(event: KeyLike, hasSelection: boolean, mac: boolean): boolean {
  if (event.code !== 'KeyC' || event.altKey) return false
  if ((event.ctrlKey || event.metaKey) && event.shiftKey) return true
  return !mac && hasSelection && event.ctrlKey && !event.metaKey && !event.shiftKey
}

/**
 * 调字号（docs/ui/terminal-small-polish.md §2）：Ctrl/⌘ + + 或 = 放大（1），- 缩小（-1），0 恢复跟随界面（0）；不是返回 null。
 * 按键上印的字符（key）认，不按位置（code）：德语键盘的 - 在 Slash 位置、+ 在 BracketRight，按位置认会让整个窗口缩放。
 * 小键盘的 + - 0 也是这几个字符
 */
export function zoomKey(event: KeyLike, mac: boolean): 1 | -1 | 0 | null {
  if (event.altKey || !(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return null
  if (event.key === '+' || event.key === '=') return 1
  if (event.key === '-') return -1
  if (event.key === '0') return 0
  return null
}

/**
 * 「粘贴」：Ctrl/⌘+Shift+V 一直是；Windows / Linux 上 Ctrl+V 也是（和 Windows Terminal、VS Code 一样，不再发 ^V 给 Shell）。
 * macOS 的 ⌘V 走浏览器自己的粘贴事件，Ctrl+V 照旧交给 Shell
 */
export function isPasteKey(event: KeyLike, mac: boolean): boolean {
  if (event.code !== 'KeyV' || event.altKey) return false
  if ((event.ctrlKey || event.metaKey) && event.shiftKey) return true
  return !mac && event.ctrlKey && !event.metaKey
}
