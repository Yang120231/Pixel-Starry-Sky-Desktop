// 对话流里没渲染过的块的估计高度（docs/ui/conversation-ux.md §2.7）。
// 块加了 content-visibility: auto，看不见的块按这个高度占位；只求大致接近，让滚动条长度和拖动位置不至于差太多。
// 渲染过一次以后浏览器记住真实高度（contain-intrinsic-block-size 的 auto），不再用这里的估计
import type { Item } from '@pixelsky/protocol'
import { FOLD_OVER, FOLD_SHOW } from '@/ui/code/CodeBlock'

/** 正文一行（含行距） */
const PROSE_LINE = 26
/** 空行（段落间距） */
const BLANK = 10
/** 代码一行 */
const CODE_LINE = 20
/** 代码块的标题栏和上下内边距 */
const CODE_CHROME = 56
/** 长代码块折叠后底部的「展开全部」 */
const FOLD_BUTTON = 36
/** 一行正文大约容纳的宽度单位：中日韩字算 2，其余算 1 */
const LINE_UNITS = 110
/** 工具行、思考、待办这类单行条目 */
export const ROW = 30
/** 估计值上限：再长的块也不至于超过这个，避免离谱的估计把滚动条撑得太长 */
const MAX = 50_000

function units(line: string): number {
  let n = 0
  for (const ch of line) n += ch.charCodeAt(0) >= 0x2e80 ? 2 : 1
  return n
}

const proseLines = (line: string, perLine = LINE_UNITS): number => Math.max(1, Math.ceil(units(line) / perLine))

/** 回复（Markdown）：正文按折行估，代码块按行数，超过 FOLD_OVER 行的折叠后只显示 FOLD_SHOW 行 */
export function markdownHeight(text: string): number {
  let height = 0,
    code = -1
  const codeBlock = (lines: number): number =>
    CODE_CHROME + CODE_LINE * (lines > FOLD_OVER ? FOLD_SHOW : lines) + (lines > FOLD_OVER ? FOLD_BUTTON : 0)
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (code < 0) code = 0
      else {
        height += codeBlock(code)
        code = -1
      }
    } else if (code >= 0) code++
    else height += line.trim() ? PROSE_LINE * proseLines(line) : BLANK
  }
  // 还没闭合的代码块（流式输出中）
  if (code >= 0) height += codeBlock(code)
  return Math.min(MAX, Math.round(height))
}

export function itemHeight(item: Item): number {
  switch (item.kind) {
    case 'user':
      // 气泡最宽约为正文的四分之三
      return Math.min(MAX, 20 + PROSE_LINE * item.text.split('\n').reduce((n, l) => n + proseLines(l, 80), 0))
    case 'assistant':
      return markdownHeight(item.text)
    case 'notice':
      return 40
    case 'compaction':
      return 44
    default:
      return ROW
  }
}

/** 一组连续的工具行 */
export const toolsHeight = (count: number): number => ROW * count

/** 改动文件卡片 */
export const changesHeight = (files: number): number => 50 + 34 * files
