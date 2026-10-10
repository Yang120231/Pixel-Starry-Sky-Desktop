// diff 行评论（docs/ui/rewind-fork-sidechat.md §4）：行号计算和注入接口。ui/ 只定义接口，存储和发送在 features/ 里
import { createContext } from 'react'

export interface DiffComment {
  id: string
  path: string
  /** 新文件的行号；删掉的行用旧文件行号（side 为 old） */
  line: number
  side: 'new' | 'old'
  /** 这一行的代码（去掉 +/-/空格） */
  code: string
  text: string
}

export interface DiffCommentsApi {
  list(path: string): DiffComment[]
  add(comment: Omit<DiffComment, 'id'>): void
  update(id: string, text: string): void
  remove(id: string): void
}

/** 由会话视图提供；没有提供时 diff 不显示评论按钮 */
export const DiffCommentsContext = createContext<DiffCommentsApi | null>(null)

export type LineNumber = { side: 'new' | 'old'; n: number } | null

/**
 * 每行 diff 对应的行号：按 @@ -a,b +c,d @@ 段头算；没有段头的整文件 diff 从 1 开始。
 * 增加行和上下文行用新文件行号，删除行用旧文件行号；段头、文件头为 null。
 */
export function diffLineNumbers(lines: string[]): LineNumber[] {
  let oldN = 1,
    newN = 1
  return lines.map(line => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldN = Number(hunk[1])
      newN = Number(hunk[2])
      return null
    }
    if (line.startsWith('+++') || line.startsWith('---')) return null
    if (line.startsWith('+')) return { side: 'new', n: newN++ }
    if (line.startsWith('-')) return { side: 'old', n: oldN++ }
    if (line.startsWith(' ')) {
      oldN++
      return { side: 'new', n: newN++ }
    }
    return null
  })
}
