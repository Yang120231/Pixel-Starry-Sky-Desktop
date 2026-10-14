// 用户消息的文字（docs/ui/content-highlight.md §2 F）：开头的 /命令、$技能 显示成主色；
// @路径 是项目里存在的文件时显示成文件标签，单击打开、双击在文件夹中显示（判断和打开由 PathLinksProvider 提供，docs/ui/path-click.md）；
// 从编辑器引用的代码（docs/ui/editor-quote.md）开头那行「路径#L12-18」和 @路径#L12-18 也是文件标签，带行号，点击跳到第一行。
import { FileText } from 'lucide-react'
import { pathData, usePathClick, usePathTarget } from '@/ui/markdown/pathLinks'
import { quoteHeading } from '../quote'

export type UserTextPart =
  | { kind: 'text'; text: string }
  | { kind: 'command'; text: string }
  /** text 是原文，path 是文件路径（@ 后面的部分，不含 #L 行号）；lines 是 #L 写的行号范围 */
  | { kind: 'mention'; text: string; path: string; lines?: { start: number; end: number } }

/** 开头的 /命令 或 $技能（Codex），名字里可以有 : . - */
const COMMAND = /^[/$][A-Za-z][\w:.-]*(?=\s|$)/
/**
 * @ 前面是开头或空白；路径到空白或中文标点为止（中文里标点后面常常不空格），
 * 末尾的英文标点（句号、逗号、冒号、括号）不算进路径
 */
const MENTION = /(^|\s)@([^\s@，。；：！？、）】」》]+?)(?=[,.;:!?)\]]*(?:[\s，。；：！？、）】」》]|$))/g

/** leading：这段是整条消息的开头（消息被代码块分成几段时，只有第一段认 /命令） */
export function userTextParts(text: string, leading = true): UserTextPart[] {
  const parts: UserTextPart[] = []
  let rest = text
  const command = leading ? COMMAND.exec(text) : null
  if (command) {
    parts.push({ kind: 'command', text: command[0] })
    rest = text.slice(command[0].length)
  }
  const pushText = (value: string) => {
    const last = parts[parts.length - 1]
    if (last?.kind === 'text') last.text += value
    else if (value) parts.push({ kind: 'text', text: value })
  }
  rest.split('\n').forEach((line, i) => {
    if (i) pushText('\n')
    const heading = quoteHeading(line)
    if (heading) {
      parts.push({
        kind: 'mention',
        text: line,
        path: heading.path,
        lines: { start: heading.startLine, end: heading.endLine },
      })
      return
    }
    let at = 0
    for (const m of line.matchAll(MENTION)) {
      const start = m.index + m[1].length
      if (start > at) pushText(line.slice(at, start))
      const ref = quoteHeading(m[2])
      parts.push(
        ref
          ? { kind: 'mention', text: '@' + m[2], path: ref.path, lines: { start: ref.startLine, end: ref.endLine } }
          : { kind: 'mention', text: '@' + m[2], path: m[2] },
      )
      at = start + 1 + m[2].length
    }
    if (at < line.length) pushText(line.slice(at))
  })
  return parts
}

function Mention({ text, path, lines }: { text: string; path: string; lines?: { start: number; end: number } }) {
  const target = usePathTarget(lines ? `${path}:${lines.start}` : path)
  const click = usePathClick(target)
  if (!click || !target) return <>{text}</>
  return (
    <button
      type="button"
      {...pathData(target)}
      title={click.title}
      {...click.handlers}
      className="mx-px inline-flex max-w-full items-baseline gap-1 rounded-sm border border-line bg-surface px-1 align-baseline font-mono text-[0.9em] text-code-path hover:border-line-strong hover:underline"
    >
      <FileText size={12} strokeWidth={1.75} className="shrink-0 self-center" />
      <span className="truncate">{path}</span>
      {lines && (
        <span className="-ml-1 shrink-0 text-fg-muted">
          :{lines.start}
          {lines.end > lines.start && `-${lines.end}`}
        </span>
      )}
    </button>
  )
}

export function UserText({ text, leading = true }: { text: string; leading?: boolean }) {
  return (
    <>
      {userTextParts(text, leading).map((p, i) =>
        p.kind === 'command' ? (
          <span key={i} className="font-medium text-accent-fg">
            {p.text}
          </span>
        ) : p.kind === 'mention' ? (
          <Mention key={i} text={p.text} path={p.path} lines={p.lines} />
        ) : (
          p.text
        ),
      )}
    </>
  )
}
