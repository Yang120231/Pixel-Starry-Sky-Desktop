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

export function titleFrom(text: string): string {
  // 第一行去掉记号后没字（代码块开头 ```ts、提示块的 > [!NOTE]）时往下找
  const line =
    text
      .trim()
      .split(/\r?\n/)
      .filter(l => !/^\s*(?:`{3,}|~{3,})/.test(l))
      .map(plainLine)
      .find(Boolean) ?? ''
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line || NEW_TITLE
}
