import { allMessages, translateMessage as translateMessageFor, translateTextFor } from '../../../shared/i18n/translate'
import type { TranslationKey } from '../../../shared/i18n/translate'
import type { Locale } from '../../../shared/i18n/messages'

// 词典与纯翻译函数在 src/shared/i18n（main 也要用）；这里保留 locale 可变状态，并转出原来对外的名字。
export { allMessages, translateTextFor }
export type { TranslationKey }

let locale: Locale = 'zh-CN'
export const getLocale = (): Locale => locale
export const setCurrentLocale = (next: Locale): void => {
  locale = next
}
export function tr(
  key: TranslationKey,
  values: Record<string, string | number | boolean | null | undefined> = {},
): string {
  const message = allMessages[key][locale === 'en-US' ? 'en' : 'zh']
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    values[name] === undefined ? placeholder : String(values[name] ?? ''),
  )
}

/** 兼容旧组件和主进程返回的固定宿主提示。只在明确的 UI 字段调用。 */
export function translateText(value: string): string {
  return translateTextFor(locale, value)
}

/** 仅用于宿主错误、状态和系统通知，不应用于消息正文或文件内容。省略语言时用当前界面语言。 */
export function translateMessage(input: string | null | undefined, language: Locale = locale): string {
  return translateMessageFor(input, language)
}
