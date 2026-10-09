import { BrowserWindow, ipcMain } from 'electron'
import { trustedSender } from './account'
import type { Locale } from '../shared/i18n/messages'
import { translateMessage } from '../shared/i18n/translate'

const languages = new WeakMap<BrowserWindow, Locale>()
let lastLanguage: Locale = 'zh-CN'
export function windowLocale(win?: BrowserWindow | null): Locale {
  return win ? (languages.get(win) ?? lastLanguage) : lastLanguage
}
export function nativeText(win: BrowserWindow | null | undefined, value: string): string {
  return translateMessage(value, windowLocale(win))
}
export function initUiLanguage(onChange: (language: Locale) => void): void {
  ipcMain.handle('ui:locale', (event, language: unknown) => {
    if (!trustedSender(event) || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的调用方')
    if (language !== 'zh-CN' && language !== 'en-US') throw new Error('不支持的语言')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    lastLanguage = language
    languages.set(win, language)
    win.setTitle(language === 'en-US' ? 'Pixel Starry Sky' : '像素星空')
    onChange(language)
  })
}
