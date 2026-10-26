// Codex 回复里的行内标记（codex-rs/tui/src/assistant_directives.rs、markdown_render/inline_directives.rs）：
// `:codex-file-citation{path="…" purpose="output"}` 标出它生成 / 引用的文件，`:codex-followup[文字]{…}` 是建议的下一步。
// Codex 自己的界面把前者画成文件链接、后者只留文字。这里在 Markdown 解析之前替换（路径里的 \ _ * 不会先被当成记号），
// 代码块和行内代码里的原样保留。桌面、手机、会话列表预览都用，所以放在协议包里。

export interface CodexCitation {
  path: string
  /** 全部属性（含 path、purpose 等），原样 */
  attributes: Readonly<Record<string, string>>
}

/** 粗略切出代码块（围栏只在行首开、行首关）和行内代码；行中间没配对的 ``` 是普通文字，不能把后面全当成代码 */
const CODE = /((?<=^|\n)[ \t]*```[\s\S]*?(?:\n[ \t]*```|$)|(?<=^|\n)[ \t]*~~~[\s\S]*?(?:\n[ \t]*~~~|$)|`[^`\n]*`)/
/** 1～3 个冒号开头；前面紧挨着冒号的不算（Codex 同样的规则） */
const MARK = /(?<!:)(:{1,3})(codex-file-citation|codex-followup)(?=[[{])/g
const KEY = /[A-Za-z0-9_-]+/y
const BARE = /[^ \t}\r\n]+/y

/** 把文字里的 Codex 行内标记换掉：文件引用换成 cite 的结果，下一步建议只留文字；没有标记时原样返回 */
export function replaceCodexDirectives(text: string, cite: (c: CodexCitation) => string): string {
  if (!text.includes('codex-file-citation') && !text.includes(':codex-followup[')) return text
  return text
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : replacePart(part, cite)))
    .join('')
}

/** 引用的文件名（链接文字）：路径最后一段 */
export const citationName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

function replacePart(text: string, cite: (c: CodexCitation) => string): string {
  let out = ''
  let from = 0
  MARK.lastIndex = 0
  for (let m; (m = MARK.exec(text)); ) {
    // 前面有奇数个 \：被转义了，不是标记
    let slashes = 0
    while (text[m.index - 1 - slashes] === '\\') slashes++
    if (slashes % 2) continue
    const name = m[2]
    const parsed = parse(text, m.index + m[0].length, name === 'codex-followup')
    if (!parsed) continue
    let replacement: string | null = null
    if (name === 'codex-file-citation') {
      if (parsed.attributes.path) replacement = cite({ path: parsed.attributes.path, attributes: parsed.attributes })
    } else if (m[1] === ':' && parsed.label?.trim()) replacement = parsed.label
    if (replacement === null) continue
    out += text.slice(from, m.index) + replacement
    from = MARK.lastIndex = parsed.end
  }
  return from ? out + text.slice(from) : text
}

/** 从 [ 或 { 开始解析：[文字]（只有下一步建议有）+ {属性}；值不能跨行，属性不能重复 */
function parse(
  text: string,
  at: number,
  followup: boolean,
): { label?: string; attributes: Record<string, string>; end: number } | null {
  let i = at
  let label: string | undefined
  if (text[i] === '[') {
    if (!followup) return null
    let depth = 1
    let j = i + 1
    for (; j < text.length; j++) {
      const c = text[j]
      if (c === '\n' || c === '\r') return null
      if (c === '\\') j++
      else if (c === '[') depth++
      else if (c === ']' && --depth === 0) break
    }
    if (j >= text.length) return null
    label = text.slice(i + 1, j)
    i = j + 1
  }
  if (text[i] !== '{') return null
  i++
  const attributes: Record<string, string> = Object.create(null)
  for (;;) {
    while (text[i] === ' ' || text[i] === '\t') i++
    if (text[i] === '}') return { label, attributes, end: i + 1 }
    KEY.lastIndex = i
    const key = KEY.exec(text)?.[0]
    if (!key || key in attributes) return null
    i += key.length
    while (text[i] === ' ' || text[i] === '\t') i++
    if (text[i] !== '=') return null
    i++
    while (text[i] === ' ' || text[i] === '\t') i++
    const quote = text[i]
    let value: string
    if (quote === '"' || quote === "'") {
      // 引用的路径按字面读（Windows 路径里的 \ 不是转义）；其它标记里 \" 是引号本身
      let j = i + 1
      for (; j < text.length && text[j] !== quote; j++) {
        if (text[j] === '\n' || text[j] === '\r') return null
        if (followup && text[j] === '\\' && text[j + 1] === quote) j++
      }
      if (j >= text.length) return null
      value = text.slice(i + 1, j)
      if (followup) value = value.replaceAll('\\' + quote, quote)
      i = j + 1
    } else {
      BARE.lastIndex = i
      const bare = BARE.exec(text)?.[0]
      if (!bare) return null
      value = bare
      i += bare.length
    }
    attributes[key] = value
  }
}

/** 纯文字显示（预览、频道摘要、通知）：引用只留文件名 */
export const codexPlainText = (text: string): string => replaceCodexDirectives(text, c => citationName(c.path))
