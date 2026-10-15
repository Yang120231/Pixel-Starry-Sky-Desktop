export interface GrammarRegex {
  /** RFC 6901 指针，指向语法 JSON 里那个正则字符串 */
  pointer: string
  source: string
  kind: 'match' | 'begin' | 'end' | 'while'
}

const CAPTURE_KEYS = ['captures', 'beginCaptures', 'endCaptures', 'whileCaptures'] as const
const REGEX_KEYS = ['match', 'begin', 'end', 'while'] as const

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function esc(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1')
}

function walkRule(rule: unknown, pointer: string, out: GrammarRegex[], depth: number): void {
  if (!isObject(rule) || depth > 64) return
  for (const kind of REGEX_KEYS) {
    const v = rule[kind]
    if (typeof v === 'string') out.push({ pointer: `${pointer}/${kind}`, source: v, kind })
  }
  for (const key of CAPTURE_KEYS) {
    const caps = rule[key]
    if (!isObject(caps)) continue
    for (const [k, cap] of Object.entries(caps)) {
      if (isObject(cap)) walkPatterns(cap['patterns'], `${pointer}/${key}/${esc(k)}/patterns`, out, depth + 1)
    }
  }
  walkPatterns(rule['patterns'], `${pointer}/patterns`, out, depth + 1)
}

function walkPatterns(list: unknown, pointer: string, out: GrammarRegex[], depth: number): void {
  if (!Array.isArray(list)) return
  list.forEach((rule, i) => walkRule(rule, `${pointer}/${i}`, out, depth))
}

function walkMap(map: unknown, pointer: string, out: GrammarRegex[]): void {
  if (!isObject(map)) return
  for (const [k, rule] of Object.entries(map)) walkRule(rule, `${pointer}/${esc(k)}`, out, 0)
}

/** 遍历 patterns[]、repository.*、injections.*、各种 captures.*.patterns；结果按在文件里出现的先后排 */
export function collectRegexes(grammar: unknown): GrammarRegex[] {
  const out: GrammarRegex[] = []
  if (!isObject(grammar)) return out
  walkPatterns(grammar['patterns'], '/patterns', out, 0)
  walkMap(grammar['repository'], '/repository', out)
  walkMap(grammar['injections'], '/injections', out)
  return out
}

/** end / while 里的反向引用（反斜杠加 1 到 99）换成 (?:)：运行时会代入 begin 的捕获 */
export function neutralizeBackrefs(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const next = src[i + 1]
    if (next === undefined) {
      out += c
      break
    }
    if (next >= '1' && next <= '9') {
      i += 1
      if (src[i + 1] !== undefined && src[i + 1] >= '0' && src[i + 1] <= '9') i += 1
      out += '(?:)'
      continue
    }
    // 反斜杠连同后一个字符成对吃掉：转义过的反斜杠后面的数字不是反向引用
    out += c + next
    i += 1
  }
  return out
}
