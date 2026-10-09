import type { SkillCommand } from '@pixelsky/protocol'
import { commandMessages } from './commandMessages'
import { getLocale } from './core'
import type { Locale } from './messages'

/** 只翻译引擎明确标记为 builtin 的命令，保护同名用户技能与插件原始描述。 */
export function commandDescription(command: SkillCommand, locale: Locale = getLocale()): string {
  if (command.source !== 'engine' || command.builtin !== true) return command.description
  const key = `commands.${command.name}` as keyof typeof commandMessages
  if (!Object.hasOwn(commandMessages, key)) return command.description
  if (locale === 'en-US') return command.description || commandMessages[key].en
  return commandMessages[key].zh
}
