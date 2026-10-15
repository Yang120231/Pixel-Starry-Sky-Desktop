import { grammarMatchScore } from '@pixelsky/protocol'
import type { ExtGrammar, ExtPackInfo, ExtPackState } from '@pixelsky/protocol'
import { compareContributionPriority, contributionsFrom } from '@/features/extpacks/model'
import { getPackState } from '@/features/extpacks/store'
import { builtinLanguageName } from './builtinLanguages'

/** 内置语言显示名 → VS Code 语言 id（扩展的 language / 片段按这个 id 对上） */
export const BUILTIN_LANGUAGE_IDS: Record<string, string> = {
  TypeScript: 'typescript',
  TSX: 'typescriptreact',
  JavaScript: 'javascript',
  JSX: 'javascriptreact',
  JSON: 'json',
  CSS: 'css',
  HTML: 'html',
  Markdown: 'markdown',
  Python: 'python',
  Rust: 'rust',
  Go: 'go',
  YAML: 'yaml',
  TOML: 'toml',
  Shell: 'shellscript',
  SQL: 'sql',
  Java: 'java',
  Kotlin: 'kotlin',
  Scala: 'scala',
  Groovy: 'groovy',
  C: 'c',
  'C++': 'cpp',
  'C#': 'csharp',
  XML: 'xml',
  Properties: 'properties',
  INI: 'ini',
  Dockerfile: 'dockerfile',
}

export interface PackGrammarRef {
  pack: ExtPackInfo
  /** 清单下标 */
  index: number
  grammar: ExtGrammar
  /** `${pack.key}@${pack.revision}#${index}`：扩展重新加载后变化，编辑器据此重新加载语言 */
  key: string
}

/** 覆盖内置高亮的开关用这个键存（options.overrideBuiltin） */
export function grammarOverrideKey(g: ExtGrammar): string {
  return g.language ?? g.scopeName
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * 这个文件该用哪个扩展语法：得分最高的赢，同分后装的赢（addedAt 大，再比下标大）；
 * 路径本来有内置语言、而用户没打开「用这个扩展代替内置高亮」时返回 null（内置优先）
 */
export function packGrammarForPath(path: string, firstLine?: string, state?: ExtPackState): PackGrammarRef | null {
  const name = baseName(path)
  let best: { ref: PackGrammarRef; score: number } | null = null
  for (const { pack, index, item } of contributionsFrom(state ?? getPackState(), 'grammars')) {
    if (!item.language) continue
    const score = grammarMatchScore(item, name, firstLine)
    if (!score) continue
    const better =
      !best ||
      score > best.score ||
      (score === best.score && compareContributionPriority({ pack, index }, best.ref) > 0)
    if (better) best = { ref: { pack, index, grammar: item, key: `${pack.key}@${pack.revision}#${index}` }, score }
  }
  if (!best) return null
  const { ref } = best
  if (
    builtinLanguageName(path) !== null &&
    !ref.pack.options.overrideBuiltin?.includes(grammarOverrideKey(ref.grammar))
  )
    return null
  return ref
}

/** 这个语法的扩展名 / 文件名 / 通配会撞上的内置语言显示名（去重） */
export function grammarBuiltinConflicts(g: ExtGrammar): string[] {
  const out = new Set<string>()
  const add = (name: string | null): void => {
    if (name) out.add(name)
  }
  for (const ext of g.extensions ?? []) add(builtinLanguageName('x' + ext))
  for (const f of g.filenames ?? []) add(builtinLanguageName(f))
  for (const p of g.filenamePatterns ?? []) add(builtinLanguageName(p.replace(/\*/g, 'x')))
  return [...out]
}

/** 语言 id：扩展语法优先，其次内置，认不出 null */
export function languageIdForPath(path: string, firstLine?: string): string | null {
  const ref = packGrammarForPath(path, firstLine)
  if (ref) return ref.grammar.language ?? null
  const name = builtinLanguageName(path)
  return name ? (BUILTIN_LANGUAGE_IDS[name] ?? null) : null
}

/** 'pack:<ref.key>' | 'builtin:<name>' | 'plain'：值变了才需要重新加载语言 */
export function languageKeyForPath(path: string, firstLine?: string): string {
  const ref = packGrammarForPath(path, firstLine)
  if (ref) return 'pack:' + ref.key
  const name = builtinLanguageName(path)
  return name ? 'builtin:' + name : 'plain'
}

/** 文档第一行（字符串或 CodeMirror 的 Text） */
export function firstLineOf(doc: string | { line(n: number): { text: string }; lines: number }): string {
  if (typeof doc === 'string') {
    const i = doc.indexOf('\n')
    return (i < 0 ? doc : doc.slice(0, i)).replace(/\r$/, '')
  }
  return doc.lines > 0 ? doc.line(1).text : ''
}
