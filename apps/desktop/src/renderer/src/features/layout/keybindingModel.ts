// 组合键的表示、显示和检查（docs/ui/custom-shortcuts.md）：纯函数，不碰 window，测试里传 mac 参数。
// mod = Ctrl（macOS 上是 ⌘）；按键用 KeyboardEvent.code（按键位置），中文输入法开着时 e.key 可能是 'Process'

export interface Binding {
  code: string
  mod: boolean
  shift: boolean
  alt: boolean
}

export interface KeyEventLike {
  code: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/

const NAMES: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
}

/** 按键本身的名字：KeyB → B、Digit1 → 1、Comma → ,、Enter → Enter（macOS ↩） */
export function keyName(code: string, mac: boolean): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return 'Num' + code.slice(6)
  if (/^F\d{1,2}$/.test(code)) return code
  if (code === 'Enter' || code === 'NumpadEnter') return mac ? '↩' : 'Enter'
  return NAMES[code] ?? code
}

/** 显示文字：Windows「Ctrl+Shift+D」，macOS「⇧⌘D」（和系统菜单的写法一致） */
export function formatBinding(b: Binding, mac: boolean): string {
  const key = keyName(b.code, mac)
  if (mac) return `${b.alt ? '⌥' : ''}${b.shift ? '⇧' : ''}${b.mod ? '⌘' : ''}${key}`
  return [b.mod && 'Ctrl', b.alt && 'Alt', b.shift && 'Shift', key].filter(Boolean).join('+')
}

/** 按键事件 → 组合键；只按了修饰键时为 null。macOS 上 Ctrl 不算 mod（⌘ 才算） */
export function bindingFromEvent(e: KeyEventLike, mac: boolean): Binding | null {
  if (MODIFIER_CODES.test(e.code) || !e.code) return null
  return { code: e.code, mod: mac ? e.metaKey : e.ctrlKey, shift: e.shiftKey, alt: e.altKey }
}

/** 按键事件是不是这个组合键；另一个平台的修饰键（Windows 的 ⊞、macOS 的 Ctrl）按着时不算 */
export function matchesBinding(e: KeyEventLike, b: Binding, mac: boolean): boolean {
  const code = e.code === 'NumpadEnter' ? 'Enter' : e.code
  if (code !== b.code || e.shiftKey !== b.shift || e.altKey !== b.alt) return false
  return mac ? e.metaKey === b.mod && !e.ctrlKey : e.ctrlKey === b.mod && !e.metaKey
}

export const sameBinding = (a: Binding, b: Binding): boolean =>
  a.code === b.code && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt

/** 复制、粘贴、剪切、全选、撤销、重做：留给输入框和编辑器 */
const RESERVED = ['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ', 'KeyY']

export type BindingProblem = 'modifier' | 'reserved'

/** 录制的组合键能不能用：要带 mod 或 Alt（F1–F12 可以不带）；不收编辑组合 */
export function bindingProblem(b: Binding): BindingProblem | null {
  if (!b.mod && !b.alt && !/^F\d{1,2}$/.test(b.code)) return 'modifier'
  if (b.mod && !b.alt && RESERVED.includes(b.code)) return 'reserved'
  return null
}

/** 本机保存的自定义：只收形状对的，坏数据当作没改 */
export function parseBinding(value: unknown): Binding | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.code !== 'string' || !v.code) return null
  return { code: v.code, mod: v.mod === true, shift: v.shift === true, alt: v.alt === true }
}
