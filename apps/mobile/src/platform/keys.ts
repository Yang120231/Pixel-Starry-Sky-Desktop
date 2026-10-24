// 键盘快捷键（电脑浏览器、接了键盘的平板，docs/mobile-remote.md §25）。只认不和浏览器自己抢的组合：
// 不用 Ctrl+N / Ctrl+T / Ctrl+W；字母按 e.code 认，macOS 上 Alt+N 打出的「˜」也算。
// 输入框里打字时，单个字符的「/」「?」不算快捷键；输入框里有字时，会换页的 Alt+N、Alt+↑↓ 也不算（换页会丢掉没发的字，
// macOS 上 ⌥↑↓ 本来是移动光标）。审批卡自己的 Ctrl+Enter / Ctrl+Backspace 在 ApprovalCard 里。
import { useEffect, useRef } from 'react'
import { L } from '@/i18n'

export type Shortcut = 'search' | 'new' | 'prev' | 'next' | 'focus' | 'stop' | 'help'

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

/** 焦点在哪：不在输入框 / 在空的输入框 / 在有字的输入框 */
export type FocusField = 'none' | 'empty' | 'text'

/** 这次按键是哪个快捷键；不是返回 null */
export function shortcutOf(e: KeyLike, field: FocusField): Shortcut | null {
  if (e.isComposing) return null
  const mod = e.ctrlKey || e.metaKey
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyK') return 'search'
  if (mod && !e.altKey && e.key === '.') return 'stop'
  if (e.altKey && !mod && !e.shiftKey && field !== 'text') {
    if (e.code === 'KeyN') return 'new'
    if (e.key === 'ArrowUp') return 'prev'
    if (e.key === 'ArrowDown') return 'next'
  }
  if (field !== 'none' || mod || e.altKey) return null
  if (e.key === '/') return 'focus'
  if (e.key === '?') return 'help'
  return null
}

/** 焦点是不是在能打字的地方（输入框、可编辑区域） */
export const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

function focusField(el: EventTarget | null): FocusField {
  if (!isEditable(el)) return 'none'
  const value = (el as HTMLInputElement).value
  return typeof value === 'string' && value.length > 0
    ? 'text'
    : (el as HTMLElement).isContentEditable && (el as HTMLElement).textContent
      ? 'text'
      : 'empty'
}

/** 在整页上听快捷键；handle 返回 false 表示这次没用上（不拦浏览器默认行为） */
export function useShortcuts(handle: (s: Shortcut) => boolean | void): void {
  const ref = useRef(handle)
  ref.current = handle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const s = shortcutOf(e, focusField(e.target))
      if (s && ref.current(s) !== false) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** 找页面上看得见的第一个 [data-key-target=name]（抽屉里的搜索框、输入框）并聚焦；没有返回 false */
export function focusTarget(name: 'search' | 'composer'): boolean {
  const el = [...document.querySelectorAll<HTMLElement>(`[data-key-target="${name}"]`)].find(
    e => e.offsetParent !== null && !(e as HTMLTextAreaElement).disabled,
  )
  if (!el) return false
  el.focus()
  if (el instanceof HTMLInputElement) el.select()
  return true
}

/** 快捷键表（「?」打开的面板）；mac 上写 ⌘、⌥ */
export function shortcutList(mac: boolean): { keys: string[]; label: string }[] {
  const ctrl = mac ? '⌘' : 'Ctrl',
    alt = mac ? '⌥' : 'Alt'
  return [
    { keys: [ctrl, 'K'], label: L('搜索会话', 'Search conversations') },
    { keys: [alt, 'N'], label: L('新建会话', 'New conversation') },
    { keys: [alt, '↑ / ↓'], label: L('上一个 / 下一个会话', 'Previous / next conversation') },
    { keys: ['/'], label: L('跳到输入框', 'Jump to message box') },
    { keys: ['Enter'], label: L('发送（Shift+Enter 换行）', 'Send (Shift+Enter for new line)') },
    { keys: [ctrl, '.'], label: L('停止这一轮', 'Stop this turn') },
    { keys: [ctrl, 'Enter'], label: L('审批：允许', 'Approval: allow') },
    { keys: [ctrl, mac ? '⌫' : 'Backspace'], label: L('审批：拒绝', 'Approval: deny') },
    { keys: ['Esc'], label: L('关闭面板', 'Close panel') },
    { keys: ['?'], label: L('显示这张表', 'Show this list') },
  ]
}

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
