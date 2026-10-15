import { parseArgs } from 'node:util'
import type { ExtCheckLevel } from '@pixelsky/protocol/extpacks'
import { UsageError } from '../lib/check'
import type { GrammarOption } from '../lib/check'
import { pickLang, t } from './i18n'
import type { Lang } from './i18n'
import type { CliIo } from './io'
import { APP_VERSION } from './version'

export interface ParsedCli {
  command: 'validate' | 'pack' | 'help' | 'version'
  path: string
  level: ExtCheckLevel
  grammar: GrammarOption
  appVersion: string | null
  strict: boolean
  json: boolean
  lang: Lang
  color: boolean
  out?: string
  dryRun: boolean
  helpFor?: string
}

const OPTIONS = {
  level: { type: 'string' },
  grammar: { type: 'string' },
  'app-version': { type: 'string' },
  strict: { type: 'boolean' },
  json: { type: 'boolean' },
  lang: { type: 'string' },
  'no-color': { type: 'boolean' },
  out: { type: 'string', short: 'o' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
} as const

/** 中英文案都带上，由上层按语言挑 */
function usage(_lang: Lang, key: string, params?: Record<string, string | number>): UsageError {
  return new UsageError(t('zh', key, params), t('en', key, params))
}

function oneOf<T extends string>(
  lang: Lang,
  flag: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined
  if ((allowed as readonly string[]).includes(value)) return value as T
  throw usage(lang, 'err.badValue', { flag, allowed: allowed.join(' | '), got: value })
}

/** 颜色：--no-color 最优先；FORCE_COLOR（非 0）强制开；其余看是不是终端、有没有 NO_COLOR */
function pickColor(noColor: boolean, io: CliIo): boolean {
  if (noColor) return false
  const force = io.env.FORCE_COLOR
  if (force !== undefined && force !== '' && force !== '0' && force !== 'false') return true
  if (io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '') return false
  return io.isTTY
}

/** node:util parseArgs 严格模式；用法错误抛 UsageError（中英文案都带） */
export function parseCli(argv: string[], io: CliIo): ParsedCli {
  const envLang = pickLang(undefined, io.env, io.locale)
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new UsageError(t('zh', 'err.badOption', { detail }), t('en', 'err.badOption', { detail }))
  }
  const v = parsed.values
  const lang = pickLang(oneOf(envLang, '--lang', v.lang, ['zh', 'en'] as const), io.env, io.locale)
  const color = pickColor(v['no-color'] === true, io)
  const common = { lang, color, json: v.json === true, strict: v.strict === true }
  const pos = parsed.positionals

  if (v.version === true) {
    return {
      command: 'version',
      path: '',
      level: 'upload',
      grammar: 'full',
      appVersion: null,
      dryRun: false,
      ...common,
    }
  }
  const [cmd, ...rest] = pos
  if (v.help === true || cmd === 'help') {
    const helpFor = cmd === 'help' ? rest[0] : cmd
    return {
      command: 'help',
      path: '',
      level: 'upload',
      grammar: 'full',
      appVersion: null,
      dryRun: false,
      helpFor,
      ...common,
    }
  }
  if (cmd === undefined) throw usage(lang, 'err.noCommand')
  if (cmd !== 'validate' && cmd !== 'pack') throw usage(lang, 'err.unknownCommand', { name: cmd })
  if (rest.length > 1) throw usage(lang, 'err.extraArg', { name: rest[1]! })
  const path = rest[0] ?? '.'

  if (cmd === 'pack') {
    for (const f of ['level', 'app-version'] as const) {
      if (v[f] !== undefined) throw usage(lang, 'err.notFor', { flag: `--${f}`, command: 'pack' })
    }
  } else {
    if (v.out !== undefined) throw usage(lang, 'err.notFor', { flag: '--out', command: 'validate' })
    if (v['dry-run'] === true) throw usage(lang, 'err.notFor', { flag: '--dry-run', command: 'validate' })
  }

  const level: ExtCheckLevel =
    cmd === 'pack' ? 'upload' : (oneOf(lang, '--level', v.level, ['upload', 'dev'] as const) ?? 'upload')
  const grammarFlag = oneOf(lang, '--grammar', v.grammar, ['full', 'regex', 'off'] as const)
  if (level === 'dev' && grammarFlag !== undefined && grammarFlag !== 'off') throw usage(lang, 'err.devGrammar')
  const grammar: GrammarOption = grammarFlag ?? (level === 'dev' ? 'off' : 'full')

  let appVersion: string | null = null
  if (v['app-version'] !== undefined) {
    if (level !== 'dev') throw usage(lang, 'err.uploadAppVersion')
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v['app-version'])) {
      throw usage(lang, 'err.badAppVersion', { got: v['app-version'] })
    }
    appVersion = v['app-version']
  } else if (level === 'dev') {
    appVersion = APP_VERSION
  }

  return {
    command: cmd,
    path,
    level,
    grammar,
    appVersion,
    dryRun: v['dry-run'] === true,
    out: v.out,
    ...common,
  }
}
