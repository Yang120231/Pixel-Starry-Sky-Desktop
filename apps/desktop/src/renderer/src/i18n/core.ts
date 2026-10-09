import { catalog } from './catalog'
import { systemMessages } from './systemMessages'
import { pluginMessages } from './pluginMessages'
import { sessionMessages } from './sessionMessages'
import { commandMessages } from './commandMessages'
import { codexMessages } from './codexMessages'
import { projectToolsMessages } from './projectToolsMessages'
import { terminalMessages } from './terminalMessages'
import { sidebarMessages } from './sidebarMessages'
import { projectMessages } from './projectMessages'
import { workspaceMessages } from './workspaceMessages'
import { machineMessages, machineErrors } from './machineMessages'
import { channelMessages } from './channelMessages'
import { notificationMessages } from './notificationMessages'
import { gitMessages } from './gitMessages'
import { artifactMessages } from './artifactMessages'
import type { Locale } from './messages'

export const allMessages = { ...catalog, ...systemMessages, ...pluginMessages, ...sessionMessages, ...commandMessages, ...codexMessages, ...projectToolsMessages, ...terminalMessages, ...sidebarMessages, ...projectMessages, ...workspaceMessages, ...machineMessages, ...machineErrors, ...channelMessages, ...notificationMessages, ...gitMessages, ...artifactMessages }
export type TranslationKey = keyof typeof allMessages

let locale: Locale = 'zh-CN'
export const getLocale = (): Locale => locale
export const setCurrentLocale = (next: Locale): void => { locale = next }
export function tr(key: TranslationKey, values: Record<string, string | number | boolean | null | undefined> = {}): string {
  const message = allMessages[key][locale === 'en-US' ? 'en' : 'zh']
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] === undefined ? placeholder : String(values[name] ?? ''))
}

const sourceKeys = new Map<string, TranslationKey>()
const englishKeys = new Map<string, TranslationKey>()
for (const [key, value] of Object.entries(allMessages)) {
  if (!sourceKeys.has(value.zh)) sourceKeys.set(value.zh, key as TranslationKey)
  if (!englishKeys.has(value.en)) englishKeys.set(value.en, key as TranslationKey)
}
/** 兼容旧组件和主进程返回的固定宿主提示。只在明确的 UI 字段调用。 */
export function translateText(value: string): string {
  return translateTextFor(locale, value)
}
export function translateTextFor(language: Locale, value: string): string {
  const key = sourceKeys.get(value) ?? (language === 'zh-CN' ? englishKeys.get(value) : undefined)
  return key ? allMessages[key][language === 'en-US' ? 'en' : 'zh'] : value
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 只用宿主 / 功能消息做动态匹配：catalog 是界面标签（日期、时长、计数，如「{p0}/{p1}」「{p0}s」「{p0} requests」），
// 拿来匹配引擎原文会改坏它（「Reconnecting... 3/5」→「3月5日」、「Too many requests」→「请求 Too many 次」）。
// 固定文字太少的模板（如「{action}: {icon}」）同样几乎能匹配任何文本，也不参与。
const literalChars = (text: string): number => text.replace(/\{\w+\}/g, '').match(/[\p{L}\p{N}]/gu)?.length ?? 0
const patterns = Object.entries(allMessages).filter(([key]) => !(key in catalog)).map(([, message]) => message).flatMap(message => {
  if (!/\{\w+\}/.test(message.zh)) return []
  return (['zh', 'en'] as const).filter(from => literalChars(message[from]) >= 3).map(from => {
    const names: string[] = []
    let cursor = 0, pattern = '^'
    for (const match of message[from].matchAll(/\{(\w+)\}/g)) {
      pattern += escapeRegex(message[from].slice(cursor, match.index)) + '([\\s\\S]*?)'
      cursor = match.index + match[0].length
      names.push(match[1])
    }
    pattern += escapeRegex(message[from].slice(cursor)) + '$'
    return { regex: new RegExp(pattern), names, message }
  })
})
/** 仅用于宿主错误、状态和系统通知，不应用于消息正文或文件内容。 */
export function translateMessage(input: string | null | undefined, language: Locale = locale): string {
  const value = input ?? ''
  const known = translateTextFor(language, value)
  if (known !== value || sourceKeys.has(value) || englishKeys.has(value)) return known
  for (const pattern of patterns) {
    const match = pattern.regex.exec(value)
    if (!match) continue
    const params = Object.fromEntries(pattern.names.map((name, i) => [name, match[i + 1]]))
    return pattern.message[language === 'en-US' ? 'en' : 'zh'].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
  }
  return value
}
