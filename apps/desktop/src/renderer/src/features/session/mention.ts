// 输入框里的 @ 引用文件（docs/ui/workbench-ux-3.md §2.6）：找光标前的 @ 词、插入选中的路径、把查询拆成目录和名字。纯函数
import type { FileEntry } from '../../../../shared/types/workspace'

/** 列表最多显示几条 */
export const MENTION_LIMIT = 50

export interface Mention {
  /** @ 在文字里的位置 */
  start: number
  /** @ 后面写的字（可以带 /） */
  query: string
}

/** 光标前正在写的 @ 词：@ 在开头或空白后，到光标之间没有空白（邮箱里的 @ 不算） */
export function mentionAt(text: string, caret: number): Mention | null {
  const m = /(^|\s)@([^\s@"]*)$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null
}

/** 选中一项：把 @ 词换成 @路径。文件后面补一个空格；目录后面补 / 接着选。路径里有空格时加引号 */
export function applyMention(
  text: string,
  mention: Mention,
  caret: number,
  entry: Pick<FileEntry, 'path' | 'kind'>,
): { text: string; caret: number } {
  const directory = entry.kind === 'directory'
  const insert = directory ? `@${entry.path}/` : /\s/.test(entry.path) ? `@"${entry.path}" ` : `@${entry.path} `
  const after = directory ? text.slice(caret) : text.slice(caret).replace(/^ /, '')
  return { text: text.slice(0, mention.start) + insert + after, caret: mention.start + insert.length }
}

/** 「+」菜单的「引用文件」：在光标处插入 @，前面不是空白时先补一个空格 */
export function insertMention(text: string, from: number, to: number): { text: string; caret: number } {
  const before = text.slice(0, from)
  const insert = before && !/\s$/.test(before) ? ' @' : '@'
  return { text: before + insert + text.slice(to), caret: from + insert.length }
}

/** `src/ap` → 在 src 下按 ap 找；`src/` → 列出 src；`ap` → 全项目按 ap 找；空 → 列出根目录 */
export function splitQuery(query: string): { dir: string; name: string } {
  const i = query.lastIndexOf('/')
  return i < 0 ? { dir: '', name: query } : { dir: query.slice(0, i), name: query.slice(i + 1) }
}

/** 按名字找到的结果：只留目录下的，名字开头就对上的排前面，再按路径短的在前 */
export function rankEntries(entries: readonly FileEntry[], dir: string, name: string): FileEntry[] {
  const prefix = dir ? dir.toLowerCase() + '/' : ''
  const term = name.toLowerCase()
  return entries
    .filter(e => !prefix || e.path.toLowerCase().startsWith(prefix))
    .map((e, i) => ({ e, i, head: e.name.toLowerCase().startsWith(term) ? 0 : 1 }))
    .sort((a, b) => a.head - b.head || a.e.path.length - b.e.path.length || a.i - b.i)
    .map(x => x.e)
    .slice(0, MENTION_LIMIT)
}

/**
 * 从资源管理器拖进来 / 粘贴的文件夹（GitHub #15）：在工作目录里的写成相对路径（和 @ 选出来的一样用 /），
 * 外面的写绝对路径（末尾不加分隔符：加引号时 \" 会被当成转义的引号）；路径里有空格时加引号，后面补一个空格
 */
export function folderMention(path: string, cwd: string | null | undefined): string {
  const norm = (p: string) => p.replace(/[\\/]+$/, '')
  const target = norm(path)
  const root = cwd ? norm(cwd) : ''
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(target)
  const inside =
    root &&
    (windows ? target.toLowerCase().startsWith(root.toLowerCase()) : target.startsWith(root)) &&
    /^[\\/]/.test(target.slice(root.length))
  const shown = inside ? target.slice(root.length + 1).replace(/\\/g, '/') + '/' : target
  return /\s/.test(shown) ? `@"${shown}" ` : `@${shown} `
}

/** 在光标处插入几段文字（拖进来的文件夹）：前面不是空白时先补一个空格 */
export function insertAt(text: string, from: number, to: number, insert: string): { text: string; caret: number } {
  const before = text.slice(0, from)
  const add = (before && !/\s$/.test(before) ? ' ' : '') + insert
  return { text: before + add + text.slice(to), caret: from + add.length }
}
