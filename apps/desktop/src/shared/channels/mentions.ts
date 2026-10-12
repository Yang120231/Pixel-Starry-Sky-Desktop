// 频道消息里的 @成员（docs/ui/channels.md §6）：渲染层高亮、主进程派活用同一套规则。

/** @ 前面是英文字母、数字或 _ . - 时不算提及（例如邮箱 a@b.com）；中文里「请@某人」「，@某人」都算 */
export const mentionBoundary = (text: string, i: number): boolean => i === 0 || !/[A-Za-z0-9_.-]/.test(text[i - 1])

export type MentionSegment = { text: string; memberId?: string }

/** 文本 → 普通片段和 @成员 片段；名字长的优先匹配（「前端助手」不会被「前端」截断），不认识的 @ 当普通文字 */
export function splitMentions(text: string, members: readonly { id: string; name: string }[]): MentionSegment[] {
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length)
  const segments: MentionSegment[] = []
  let plain = ''
  let i = 0
  while (i < text.length) {
    const atBoundary = text[i] === '@' && mentionBoundary(text, i)
    const member = atBoundary ? byLength.find(m => m.name && text.startsWith(m.name, i + 1)) : undefined
    if (member) {
      if (plain) segments.push({ text: plain })
      plain = ''
      segments.push({ text: `@${member.name}`, memberId: member.id })
      i += member.name.length + 1
    } else {
      plain += text[i]
      i++
    }
  }
  if (plain) segments.push({ text: plain })
  return segments
}

/** 文本里提到的成员 id，按出现顺序去重 */
export function parseMentions(text: string, members: readonly { id: string; name: string }[]): string[] {
  const ids: string[] = []
  for (const s of splitMentions(text, members)) if (s.memberId && !ids.includes(s.memberId)) ids.push(s.memberId)
  return ids
}

/** 引用条、引用块、提示词里的一行摘要 */
export function excerpt(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}
