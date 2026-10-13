// 菜单里按 1–9 选第 N 项（docs/ui/ui-polish-2026-10-13.md §5）：右键菜单（ActionMenu）和弹出菜单（Popover）共用。
// 菜单上不标数字；只数能点的项，带子菜单的项按了就打开子菜单。

interface DigitEventLike {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

/** 按的是 1–9（主键盘或小键盘、不带修饰键）就返回序号（从 0 开始），否则 -1 */
export function menuDigit(e: DigitEventLike): number {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return -1
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  return m ? Number(m[1]) - 1 : -1
}

/** 焦点在输入框、代码编辑器或终端里：数字键是打字，不选菜单 */
export function isTypingTarget(el: Element | null): boolean {
  return !!el?.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-terminal-input]',
  )
}

/** 按数字选：点第 N 个能点的项；处理了返回 true */
export function pickByDigit(e: KeyboardEvent | DigitEventLike, items: HTMLElement[]): boolean {
  const index = menuDigit(e)
  const item = index < 0 ? undefined : items[index]
  if (!item) return false
  if ('preventDefault' in e) e.preventDefault()
  item.click()
  return true
}
