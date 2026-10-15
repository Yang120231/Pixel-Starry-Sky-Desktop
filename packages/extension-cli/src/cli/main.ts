import { EXT_RULES_VERSION } from '@pixelsky/protocol/extpacks'
import { errorText, UsageError } from '../lib/check'
import { parseCli } from './args'
import { runPack } from './commands/pack'
import { runValidate } from './commands/validate'
import { helpText } from './help'
import { pickLang, t } from './i18n'
import type { Lang } from './i18n'
import type { CliHooks, CliIo } from './io'
import { APP_VERSION, TOOL_VERSION } from './version'

/** 永不抛错：UsageError 对应 2，ToolError 和其他错误对应 3 */
export async function main(argv: string[], io: CliIo, hooks: CliHooks = {}): Promise<number> {
  // 参数还没解析出来就出错时，语言和 --json 只能先靠环境变量和原始参数猜
  let lang: Lang = pickLang(undefined, io.env, io.locale)
  let json = argv.includes('--json')
  try {
    const p = parseCli(argv, io)
    lang = p.lang
    json = p.json
    if (p.command === 'version') {
      io.out(t(lang, 'ver', { tool: TOOL_VERSION, rules: EXT_RULES_VERSION, app: APP_VERSION }) + '\n')
      return 0
    }
    if (p.command === 'help') {
      io.out(helpText(lang, p.helpFor))
      return 0
    }
    return p.command === 'pack' ? await runPack(p, io, hooks) : await runValidate(p, io, hooks)
  } catch (e) {
    const usage = e instanceof UsageError
    const message = errorText(e, lang)
    if (json) {
      io.out(JSON.stringify({ schema: 1, error: { code: usage ? 'usage' : 'internal', message } }, null, 2) + '\n')
    } else {
      io.err(`${message}\n`)
      if (usage) io.err(`${t(lang, 'err.hint')}\n`)
    }
    return usage ? 2 : 3
  }
}
