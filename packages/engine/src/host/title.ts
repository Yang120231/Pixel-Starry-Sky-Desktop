// 新会话标题：第一条消息的第一行，去掉 Markdown 记号（docs/ui/conversation-ux-2.md §2.2）
export const NEW_TITLE = '新会话'
const TITLE_MAX = 30

/** 一行里的 Markdown 记号去掉，只留读得出来的字 */
function plainLine(line: string): string {
  return (
    line
      // 行首：标题、引用、列表、任务框、GitHub 提示块
      .replace(/^(?:>\s*)+/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s+/, '')
      .replace(/^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '')
      // 图片和链接只留方括号里的字
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // 行内代码的反引号、加粗
      .replace(/`+([^`]+)`+/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .trim()
  )
}

/**
 * 去掉从编辑器引用的代码（docs/ui/editor-quote.md）：单独一行的「路径#L12-18」和紧跟着的代码块。
 * 先引用代码再提问时，标题用问题，而不是路径
 */
function withoutQuotes(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^[^\s@#]+#L\d+(?:-L?\d+)?$/.test(lines[i]) ? /^(`{3,}|~{3,})/.exec(lines[i + 1] ?? '') : null
    const close = open ? lines.findIndex((l, j) => j > i + 1 && l.startsWith(open[1]) && /^[`~]+$/.test(l.trim())) : -1
    if (close < 0) out.push(lines[i])
    else i = close
  }
  return out.join('\n')
}

/** 第一行去掉记号后没字（代码块开头 ```ts、提示块的 > [!NOTE]）时往下找 */
function firstLine(text: string): string {
  return (
    text
      .trim()
      .split(/\r?\n/)
      .filter(l => !/^\s*(?:`{3,}|~{3,})/.test(l))
      .map(plainLine)
      .find(Boolean) ?? ''
  )
}

export function titleFrom(text: string): string {
  // 只有引用、没有别的字时照旧取第一行（就是路径）
  const line = firstLine(withoutQuotes(text)) || firstLine(text)
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line || NEW_TITLE
}
