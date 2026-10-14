// 输入框的右键菜单（scratch/2026-10-14-context-menu/plan.md 第一批）：设置、搜索框、重命名框这些普通输入框
// 弹系统原生的撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选。界面里自己画了菜单的地方（对话区、会话输入框、
// 编辑器、终端）会拦掉右键事件，这里收不到，不会两个菜单都弹
import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { allMessages, type TranslationKey } from '../../shared/i18n/translate'
import type { Locale } from '../../shared/i18n/messages'
import { windowLocale } from './ui-language'

type EditFlags = ContextMenuParams['editFlags']

/** 菜单项（纯函数，单测用）；不是可编辑的地方返回 null */
export function editMenuTemplate(
  params: { isEditable: boolean; editFlags: EditFlags },
  locale: Locale,
): MenuItemConstructorOptions[] | null {
  if (!params.isEditable) return null
  const text = (key: TranslationKey): string => {
    const message = allMessages[key] as { zh: string; en: string }
    return locale === 'en-US' ? message.en : message.zh
  }
  const f = params.editFlags
  return [
    { role: 'undo', label: text('ctxmenu.undo'), enabled: f.canUndo },
    { role: 'redo', label: text('ctxmenu.redo'), enabled: f.canRedo },
    { type: 'separator' },
    { role: 'cut', label: text('ctxmenu.cut'), enabled: f.canCut },
    { role: 'copy', label: text('ctxmenu.copy'), enabled: f.canCopy },
    { role: 'paste', label: text('ctxmenu.paste'), enabled: f.canPaste },
    { type: 'separator' },
    { role: 'selectAll', label: text('ctxmenu.selectAll'), enabled: f.canSelectAll },
  ]
}

export function watchEditMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const template = editMenuTemplate(params, windowLocale(win))
    if (template) Menu.buildFromTemplate(template).popup({ window: win })
  })
}
