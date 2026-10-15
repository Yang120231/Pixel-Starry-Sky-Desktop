import type { Extension } from '@codemirror/state'
import { readPackJson } from '@/features/extpacks/store'
import type { PackGrammarRef } from '../languageIds'
import { keyHighlight } from '../theme'
import { parseLanguageConfiguration, tmIndentService } from './languageConfig'
import { grammarFor } from './registry'
import { tmStreamLanguage } from './stream'

const warned = new Set<string>()

function warnOnce(key: string, err: unknown): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[extpacks] grammar ${key} unavailable`, err)
}

/** 扩展语法 → 编辑器语言：[流语言, 属性名上色, 缩进服务]；任何失败都静默退回 []（每个 key 只警告一次） */
export async function textmateLanguage(ref: PackGrammarRef): Promise<Extension> {
  try {
    const grammar = await grammarFor(ref)
    if (!grammar) return []
    let spec = {}
    if (ref.grammar.configuration) {
      try {
        spec = parseLanguageConfiguration(await readPackJson(ref.pack.key, ref.grammar.configuration)).data
      } catch (e) {
        // 配置文件坏了不影响着色
        warnOnce(`${ref.key}:config`, e)
      }
    }
    const language = tmStreamLanguage(grammar, ref.grammar.language ?? ref.grammar.scopeName, spec)
    return [language, keyHighlight(language), tmIndentService(spec)]
  } catch (e) {
    warnOnce(ref.key, e)
    return []
  }
}
