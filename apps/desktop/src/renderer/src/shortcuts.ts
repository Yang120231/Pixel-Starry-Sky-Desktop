import { tr } from './i18n/core'
/** 全局快捷键。macOS 用 ⌘，其他平台用 Ctrl。列表见 docs/ui/workbench.md §7 */

const isMac = window.pixelsky?.platform === 'darwin'

/** 收起 / 展开侧边栏：Ctrl+B（macOS ⌘B），和 Mirasim、VS Code 一致 */
export const TOGGLE_SIDEBAR = {
  label: isMac ? '⌘B' : 'Ctrl+B',
  match: (e: KeyboardEvent): boolean =>
    // 用 e.code 判断按键位置，中文输入法开着时 e.key 可能是 'Process'
    e.code === 'KeyB' && (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && !e.repeat,
}

/** 收起 / 展开右侧面板：Ctrl+Alt+B（macOS ⌥⌘B），和 VS Code 的辅助侧栏一致，与 Ctrl+B 成对好记 */
export const TOGGLE_PANEL = {
  label: isMac ? '⌥⌘B' : 'Ctrl+Alt+B',
  match: (e: KeyboardEvent): boolean =>
    e.code === 'KeyB' && (isMac ? e.metaKey : e.ctrlKey) && e.altKey && !e.shiftKey && !e.repeat,
}

/** 打开设置：Ctrl+,（macOS ⌘,），和 VS Code、Claude 桌面版一致 */
export const OPEN_SETTINGS = {
  label: isMac ? '⌘,' : 'Ctrl+,',
  match: (e: KeyboardEvent): boolean =>
    e.code === 'Comma' && (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && !e.repeat,
}

const mod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey)

export const OPEN_SEARCH = {
  label: isMac ? '⌘P' : 'Ctrl+P',
  match: (e: KeyboardEvent): boolean => e.code === 'KeyP' && mod(e) && !e.shiftKey && !e.altKey && !e.repeat,
}

// ---------------------------------------------------------------------------
// 多对话窗格（与 Mirasim 一致，docs/ui/multi-pane.md §4）
// ---------------------------------------------------------------------------

/** 向右拆分：Ctrl+D */
export const SPLIT_RIGHT = {
  label: isMac ? '⌘D' : 'Ctrl+D',
  match: (e: KeyboardEvent): boolean => e.code === 'KeyD' && mod(e) && !e.shiftKey && !e.altKey && !e.repeat,
}

/** 向下拆分：Ctrl+Shift+D */
export const SPLIT_DOWN = {
  label: isMac ? '⇧⌘D' : 'Ctrl+Shift+D',
  match: (e: KeyboardEvent): boolean => e.code === 'KeyD' && mod(e) && e.shiftKey && !e.altKey && !e.repeat,
}

/** 关闭当前标签，窗格空了就关窗格：Ctrl+W（主进程的菜单里去掉了「关闭窗口」，见 main/index.ts） */
export const CLOSE_TAB = {
  label: isMac ? '⌘W' : 'Ctrl+W',
  match: (e: KeyboardEvent): boolean => e.code === 'KeyW' && mod(e) && !e.shiftKey && !e.altKey && !e.repeat,
}

/** 放大 / 还原当前窗格：Ctrl+Shift+Enter */
export const ZOOM_PANE = {
  label: isMac ? '⇧⌘↩' : 'Ctrl+Shift+Enter',
  match: (e: KeyboardEvent): boolean => e.key === 'Enter' && mod(e) && e.shiftKey && !e.altKey && !e.repeat,
}

/** 跳到第 N 个窗格：Alt+1…6；返回窗格序号（从 0 开始），不匹配返回 -1 */
export const JUMP_PANE = {
  label: isMac ? '⌥1…6' : 'Alt+1…6',
  index: (e: KeyboardEvent): number => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1
    const m = /^Digit([1-6])$/.exec(e.code)
    return m ? Number(m[1]) - 1 : -1
  },
}

/** 切换到上一个 / 下一个窗格：Ctrl+Alt+← / →；返回 -1、1，不匹配返回 0 */
export const CYCLE_PANE = {
  label: isMac ? '⌥⌘← / →' : 'Ctrl+Alt+← / →',
  delta: (e: KeyboardEvent): number => {
    if (!mod(e) || !e.altKey || e.shiftKey) return 0
    return e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
  },
}

/** 当前窗格里切换标签：Ctrl+Tab / Ctrl+Shift+Tab（macOS 也用 Ctrl，和浏览器一致）；返回 1、-1，不匹配返回 0 */
export const CYCLE_TAB = {
  label: 'Ctrl+Tab',
  delta: (e: KeyboardEvent): number => (e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey ? (e.shiftKey ? -1 : 1) : 0),
}

/** 设置 → 快捷键 里列出的窗格快捷键 */
export const PANE_SHORTCUTS: Array<{ label: string; keys: string }> = [
  { get label() { return tr("shortcuts.message1036") }, keys: SPLIT_RIGHT.label },
  { get label() { return tr("shortcuts.message1037") }, keys: SPLIT_DOWN.label },
  { get label() { return tr("shortcuts.message1038") }, keys: CLOSE_TAB.label },
  { get label() { return tr("shortcuts.message1039") }, keys: JUMP_PANE.label },
  { get label() { return tr("shortcuts.message1040") }, keys: CYCLE_PANE.label },
  { get label() { return tr("shortcuts.message1041") }, keys: ZOOM_PANE.label },
  { get label() { return tr("shortcuts.message1042") }, keys: CYCLE_TAB.label + ' / Ctrl+Shift+Tab' },
]

/** 按钮提示文字后面带上快捷键，例如「收起侧边栏（Ctrl+B）」 */
export function withShortcut(label: string, shortcut: { label: string }): string {
  return `${label}（${shortcut.label}）`
}
