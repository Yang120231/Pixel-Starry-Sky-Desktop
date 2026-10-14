// 对话区右键菜单（scratch/2026-10-14-context-menu/plan.md 第一批）：认出点在什么上面、拼引用文字。纯函数，不碰 React
import type { PathTarget } from '@/ui/markdown/pathLinks'
import { QUOTE_MAX_CHARS, QUOTE_MAX_LINES } from '../quote'

export interface TranscriptTarget {
  /** 所在的对话条目（[data-search-item]） */
  item: string | null
  /** 代码块：原文和标注的语言 */
  code: { text: string; lang: string | null } | null
  /** 网址链接（只认 http / https；本地文件走 path） */
  link: string | null
  /** 项目里的文件或文件夹（行内代码、链接、@ 文件标签、改动的文件） */
  path: (PathTarget & { folder: boolean }) | null
  /** 链接指向项目外、本机上存在的路径（完整路径） */
  outside: { path: string; folder: boolean } | null
}

const lineNumber = (value: string | undefined): number | null => {
  const n = Number(value)
  return value && Number.isInteger(n) && n > 0 ? n : null
}

/** 从点到的元素往上找：代码块、链接、文件路径、对话条目 */
export function transcriptTarget(el: Element | null): TranscriptTarget {
  const block = el?.closest<HTMLElement>('[data-code-block]')
  const pathEl = el?.closest<HTMLElement>('[data-path]')
  const outsideEl = el?.closest<HTMLElement>('[data-path-outside]')
  const anchor = el?.closest<HTMLAnchorElement>('a[href]')
  const href =
    anchor && !anchor.hasAttribute('data-path') && !anchor.hasAttribute('data-path-outside')
      ? anchor.getAttribute('href')
      : null
  const path = pathEl?.dataset.path
  return {
    item: el?.closest<HTMLElement>('[data-search-item]')?.dataset.searchItem ?? null,
    code: block
      ? {
          text: (block.querySelector('pre code')?.textContent ?? '').replace(/\n$/, ''),
          lang: block.dataset.codeLang || null,
        }
      : null,
    link: href && /^https?:\/\//i.test(href) ? href : null,
    path: path
      ? {
          path,
          line: lineNumber(pathEl!.dataset.pathLine),
          column: lineNumber(pathEl!.dataset.pathColumn),
          folder: pathEl!.dataset.pathKind === 'folder',
        }
      : null,
    outside: outsideEl?.dataset.pathOutside
      ? { path: outsideEl.dataset.pathOutside, folder: outsideEl.dataset.pathKind === 'folder' }
      : null,
  }
}

/** 选中的文字去掉首尾空行、统一换行 */
export const cleanSelection = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\n/, '')
    .replace(/\s+$/, '')

/** 引用块：每行加「> 」（空行只留「>」），末尾换行，接着写问题时另起一行 */
export const quoteBlock = (text: string): string =>
  cleanSelection(text)
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n') + '\n'

/** 代码块插进输入框：按原来的语言围起来；内容里有 ``` 时围栏加长 */
export function fencedBlock(code: string, lang: string | null): string {
  const longest = Math.max(2, ...[...code.matchAll(/`{3,}/g)].map(m => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${lang ?? ''}\n${code}\n${fence}\n`
}

/** 太长时给出实际大小（和编辑器「引用到对话」同一个上限），没超过为 null */
export function quoteTooLong(text: string): { lines: number; chars: number } | null {
  const lines = text.split('\n').length
  return lines > QUOTE_MAX_LINES || text.length > QUOTE_MAX_CHARS ? { lines, chars: text.length } : null
}

/** Ctrl+F 会直接拿来搜的选区：一行、不太长（search/ConversationFind.tsx 的 selectedText 同一条规则） */
export const findable = (text: string): boolean => text.length > 0 && text.length <= 100 && !/[\r\n]/.test(text)

/**
 * 项目里的相对路径 → 完整路径；不知道会话目录时为 null。
 * 分隔符看会话目录本身（盘符、\\ 开头用 \），WSL、SSH 上的会话在 Windows 里也是 /
 */
export function absolutePath(cwd: string | null | undefined, path: string): string | null {
  if (!cwd) return null
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(cwd)
  const sep = windows ? '\\' : '/'
  const root = cwd.replace(/[\\/]+$/, '')
  return root + sep + (windows ? path.replaceAll('/', '\\') : path)
}
