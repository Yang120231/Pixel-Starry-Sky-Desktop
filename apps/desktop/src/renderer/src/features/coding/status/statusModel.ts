// 状态栏各项的文字（纯逻辑）
import { tr } from '../../../i18n/core'

/** 分支文字：branch ↑a ↓b；ahead / behind 为 0 时不写；游离 HEAD 写短 hash；不是仓库返回 null */
export function branchText(s: {
  repo: boolean
  branch: string | null
  detached: boolean
  head: string | null
  ahead: number
  behind: number
}): string | null {
  if (!s.repo) return null
  const name = s.branch ?? (s.head ? s.head.slice(0, 7) : null)
  if (!name) return null
  const parts = [name]
  if (s.ahead > 0) parts.push(`↑${s.ahead}`)
  if (s.behind > 0) parts.push(`↓${s.behind}`)
  return parts.join(' ')
}

/** 编码文字：UTF-8，有 BOM 时加 BOM */
export const encodingText = (bom: boolean): string => (bom ? 'UTF-8 BOM' : 'UTF-8')

/** 换行文字：LF / CRLF */
export const newlineText = (newline: string): string => newline.toUpperCase()

/** 第 {line} 行，第 {column} 列 */
export const cursorText = (c: { line: number; column: number }): string =>
  tr('coding.status.cursor', { line: c.line, column: c.column })
