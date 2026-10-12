// 上下文明细里的记忆文件（docs/ui/context-window.md §7）：渲染进程点一行时传回路径，
// 这里只放行会话诊断里列出的、确实存在的本机文件，别的路径一概不开（不接受渲染进程随便给一个路径）。
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** listed：会话最近一次上下文诊断里的记忆文件（name 是引擎给的绝对路径） */
export async function memoryFile(listed: readonly { name: string }[], path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path || path.length > 4096) throw new Error('文件路径不正确')
  if (!isAbsolute(path) || !listed.some(row => row.name === path)) throw new Error('只能打开这个会话的记忆文件')
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Error('文件不存在：' + path)
  return path
}
