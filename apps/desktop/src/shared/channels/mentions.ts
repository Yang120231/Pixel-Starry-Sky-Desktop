// 频道消息里的 @成员（docs/ui/channels.md §6）：渲染层高亮、主进程派活用同一套规则。

/** @ 前面是英文字母、数字或 _ . - 时不算提及（例如邮箱 a@b.com）；中文里「请@某人」「，@某人」都算 */
export const mentionBoundary = (text: string, i: number): boolean => i === 0 || !/[A-Za-z0-9_.-]/.test(text[i - 1])

/** @全体：派给频道里所有 AI 成员（issue #83）。两种写法都认，菜单按界面语言插入其中一种 */
export const MENTION_ALL = { zh: '全体', en: 'all' } as const
const ALL_NAMES = [MENTION_ALL.zh, MENTION_ALL.en]

/** 「全体」「all」留给 @全体，AI 成员不能叫这个名字（不分大小写） */
export const isReservedMentionName = (name: string): boolean =>
  ALL_NAMES.some(n => n.toLowerCase() === name.trim().toLowerCase())

/** kind 只用来认 @全体（展开成 kind 为 agent 的成员）；不带 kind 时 @全体 当普通文字 */
export type Mentionable = { id: string; name: string; kind?: 'agent' | 'human' }

export type MentionSegment = { text: string; memberId?: string; all?: true }

/** i 处（@ 后面）是不是 @全体：「全体」后面随便接什么；「all」后面不能紧跟英文字母、数字或 _（@allen 不算） */
function allAt(text: string, i: number): string | null {
  if (text.startsWith(MENTION_ALL.zh, i)) return MENTION_ALL.zh
  const word = text.slice(i, i + MENTION_ALL.en.length)
  if (word.toLowerCase() === MENTION_ALL.en && !/[A-Za-z0-9_]/.test(text[i + MENTION_ALL.en.length] ?? '')) return word
  return null
}

/**
 * 文本 → 普通片段和 @成员 片段；名字长的优先匹配（「前端助手」不会被「前端」截断），不认识的 @ 当普通文字。
 * 成员名优先于 @全体（老数据里可能已经有叫「全体」的成员）；频道里没有 AI 成员时 @全体 当普通文字。
 */
export function splitMentions(text: string, members: readonly Mentionable[]): MentionSegment[] {
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length)
  const hasAgents = members.some(m => m.kind === 'agent')
  const segments: MentionSegment[] = []
  let plain = ''
  let i = 0
  const flush = () => {
    if (plain) segments.push({ text: plain })
    plain = ''
  }
  while (i < text.length) {
    const atBoundary = text[i] === '@' && mentionBoundary(text, i)
    const member = atBoundary ? byLength.find(m => m.name && text.startsWith(m.name, i + 1)) : undefined
    const all = atBoundary && !member && hasAgents ? allAt(text, i + 1) : null
    if (member) {
      flush()
      segments.push({ text: `@${member.name}`, memberId: member.id })
      i += member.name.length + 1
    } else if (all) {
      flush()
      segments.push({ text: `@${all}`, all: true })
      i += all.length + 1
    } else {
      plain += text[i]
      i++
    }
  }
  flush()
  return segments
}

/** 文本里提到的成员 id，按出现顺序去重；@全体 展开成所有 AI 成员（按成员列表的顺序） */
export function parseMentions(text: string, members: readonly Mentionable[]): string[] {
  const ids: string[] = []
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id)
  }
  for (const s of splitMentions(text, members))
    if (s.memberId) add(s.memberId)
    else if (s.all) for (const m of members) if (m.kind === 'agent') add(m.id)
  return ids
}

/** 文本里有没有 @全体 */
export const mentionsAll = (text: string, members: readonly Mentionable[]): boolean =>
  splitMentions(text, members).some(s => s.all)

/** 引用条、引用块、提示词里的一行摘要 */
export function excerpt(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}
