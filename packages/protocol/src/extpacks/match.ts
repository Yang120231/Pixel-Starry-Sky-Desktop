import { hasAmbiguousQuantifiers, hasNestedQuantifier, hasQuantifiedAlternation } from './tasks'
import { wildcardMatch } from './text'
import type { ExtGrammar, ExtLocale, ExtPackContributes, ExtPackManifest, ExtText } from './types'

/** 取多语言文本；英文缺失时退回中文 */
export function extText(text: ExtText | undefined, locale: ExtLocale): string {
  if (text === undefined) return ''
  if (typeof text === 'string') return text
  return locale === 'en-US' ? text.en || text.zh : text.zh
}

export function packName(m: ExtPackManifest, locale: ExtLocale): string {
  return (locale === 'en-US' ? m.l10n?.en?.name : undefined) || m.name
}

export function packDescription(m: ExtPackManifest, locale: ExtLocale): string {
  return (locale === 'en-US' ? m.l10n?.en?.description : undefined) || m.description
}

/** 把 rel 接到 baseDir（'' = 扩展根）上；绝对路径、含 '\\' 或 ':'、逃出根目录都返回 null */
export function resolvePackPath(baseDir: string, rel: string): string | null {
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.includes(':') || rel.includes('\0')) return null
  const out: string[] = baseDir ? baseDir.split('/').filter(Boolean) : []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.length ? out.join('/') : null
}

export { wildcardMatch }

/** posix dirname；根目录下的文件返回 '' */
export function packDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** 只认 '*'，整串匹配，不分大小写 */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`, 'i')
}

/** firstLine 正则只测前这么多个字符，限制回溯代价 */
export const EXT_FIRST_LINE_MAX = 200

/** firstLine 正则的安全检查 + 编译结果缓存（每次渲染都会问）；null = 不安全或不合法，一律当不匹配 */
const firstLineCache = new Map<string, RegExp | null>()

function firstLineRegExp(pattern: string): RegExp | null {
  const hit = firstLineCache.get(pattern)
  if (hit !== undefined) return hit
  let re: RegExp | null = null
  try {
    // 嵌套量词的正则（(a+)+）会指数级回溯，截断长度也救不了：校验没拦住的（绕过校验加载的）直接当不匹配
    // 被量化的分支组（(a|aa)+）分支重叠时同样指数级回溯，一并当不匹配
    // 相邻且可重叠的量词（a*a*a*a*b）是多项式级回溯，同样一并当不匹配
    if (
      !hasNestedQuantifier(pattern) &&
      !hasQuantifiedAlternation(pattern) &&
      !hasAmbiguousQuantifiers(pattern, EXT_FIRST_LINE_MAX)
    )
      re = new RegExp(pattern)
  } catch {
    // 坏的正则当作不匹配
  }
  firstLineCache.set(pattern, re)
  return re
}

/** 0 = 不匹配；filenames 400；filenamePatterns 300；extensions 200 + 扩展名长度；firstLine 100 */
export function grammarMatchScore(g: ExtGrammar, fileName: string, firstLine?: string): number {
  const lower = fileName.toLowerCase()
  if (g.filenames?.some(f => f === fileName)) return 400
  if (g.filenamePatterns?.some(p => wildcardMatch(p, fileName))) return 300
  let best = 0
  for (const ext of g.extensions ?? []) {
    if (ext && lower.endsWith(ext.toLowerCase())) best = Math.max(best, 200 + ext.length)
  }
  if (best) return best
  if (g.firstLine && firstLine !== undefined) {
    const re = firstLineRegExp(g.firstLine)
    if (re && re.test(firstLine.slice(0, EXT_FIRST_LINE_MAX))) return 100
  }
  return 0
}

export function contributionCount(c: ExtPackContributes): number {
  let n = 0
  for (const list of Object.values(c)) if (Array.isArray(list)) n += list.length
  return n
}
