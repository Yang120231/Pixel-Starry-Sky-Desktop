// 用户消息的文字（docs/ui/content-highlight.md §2 F）：开头的 /命令、$技能 显示成主色；
// @路径 是项目里存在的文件时显示成文件标签，点击打开（判断和打开由 PathLinksProvider 提供）。
import { FileText } from 'lucide-react'
import { useOpenPath, usePathTarget } from '@/ui/markdown/pathLinks'

export type UserTextPart =
  | { kind: 'text'; text: string }
  | { kind: 'command'; text: string }
  /** text 是带 @ 的原文，path 是 @ 后面的路径 */
  | { kind: 'mention'; text: string; path: string }

/** 开头的 /命令 或 $技能（Codex），名字里可以有 : . - */
const COMMAND = /^[/$][A-Za-z][\w:.-]*(?=\s|$)/
/**
 * @ 前面是开头或空白；路径到空白或中文标点为止（中文里标点后面常常不空格），
 * 末尾的英文标点（句号、逗号、冒号、括号）不算进路径
 */
const MENTION = /(^|\s)@([^\s@，。；：！？、）】」》]+?)(?=[,.;:!?)\]]*(?:[\s，。；：！？、）】」》]|$))/g

export function userTextParts(text: string): UserTextPart[] {
  const parts: UserTextPart[] = []
  let rest = text
  const command = COMMAND.exec(text)
  if (command) {
    parts.push({ kind: 'command', text: command[0] })
    rest = text.slice(command[0].length)
  }
  let at = 0
  for (const m of rest.matchAll(MENTION)) {
    const start = m.index + m[1].length
    if (start > at) parts.push({ kind: 'text', text: rest.slice(at, start) })
    parts.push({ kind: 'mention', text: '@' + m[2], path: m[2] })
    at = start + 1 + m[2].length
  }
  if (at < rest.length) parts.push({ kind: 'text', text: rest.slice(at) })
  return parts
}

function Mention({ text, path }: { text: string; path: string }) {
  const target = usePathTarget(path)
  const open = useOpenPath()
  if (!target || !open) return <>{text}</>
  return (
    <button
      type="button"
      title={target.path}
      onClick={() => open(target)}
      className="mx-px inline-flex max-w-full items-baseline gap-1 rounded-sm border border-line bg-surface px-1 align-baseline font-mono text-[0.9em] text-code-path hover:border-line-strong hover:underline"
    >
      <FileText size={12} strokeWidth={1.75} className="shrink-0 self-center" />
      <span className="truncate">{path}</span>
    </button>
  )
}

export function UserText({ text }: { text: string }) {
  return (
    <>
      {userTextParts(text).map((p, i) =>
        p.kind === 'command' ? (
          <span key={i} className="font-medium text-accent-fg">
            {p.text}
          </span>
        ) : p.kind === 'mention' ? (
          <Mention key={i} text={p.text} path={p.path} />
        ) : (
          p.text
        ),
      )}
    </>
  )
}
