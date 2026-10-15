import { hasNestedQuantifier } from './tasks'
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

/** 只认 '*'，整串匹配，不分大小写；双指针回溯，最坏 O(名字长度 × 模式长度)，不会像拼正则那样指数 / 高次方变慢 */
export function wildcardMatch(pattern: string, name: string): boolean {
  const p = pattern.toLowerCase()
  const s = name.toLowerCase()
  let i = 0
  let j = 0
  let star = -1
  let mark = 0
  while (i < s.length) {
    if (j < p.length && p[j] === '*') {
      star = j++
      mark = i
    } else if (j < p.length && p[j] === s[i]) {
      i++
      j++
    } else if (star >= 0) {
      j = star + 1
      i = ++mark
    } else {
      return false
    }
  }
  while (j < p.length && p[j] === '*') j++
  return j === p.length
}

/** firstLine 正则只测前这么多个字符，限制回溯代价 */
export const EXT_FIRST_LINE_MAX = 200

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
    // 嵌套量词的正则（(a+)+）会指数级回溯，截断长度也救不了：校验没拦住的（绕过校验加载的）直接当不匹配
    if (hasNestedQuantifier(g.firstLine)) return 0
    try {
      if (new RegExp(g.firstLine).test(firstLine.slice(0, EXT_FIRST_LINE_MAX))) return 100
    } catch {
      // 坏的正则当作不匹配
    }
  }
  return 0
}

export function contributionCount(c: ExtPackContributes): number {
  let n = 0
  for (const list of Object.values(c)) if (Array.isArray(list)) n += list.length
  return n
}
