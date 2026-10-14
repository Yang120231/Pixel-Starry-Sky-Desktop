// 机器相关报错的文案：主进程抛的是 SSH_ / WSL_ 错误码，translateMessage 不按错误码查 machineErrors，先查这里
import { getLocale, translateMessage } from '@/i18n/core'
import type { Locale } from '../../../../shared/i18n/messages'
import { machineErrors } from '../../../../shared/i18n/machineMessages'

export function machineErrorText(error: unknown, locale: Locale = getLocale()): string {
  const raw = error instanceof Error ? error.message : String(error)
  const known = (machineErrors as Record<string, { zh: string; en: string } | undefined>)[raw]
  return known ? known[locale === 'en-US' ? 'en' : 'zh'] : translateMessage(raw, locale)
}
