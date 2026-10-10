// diff 词级高亮（docs/ui/content-highlight.md §2 C）：成对的删除 / 增加行里，找出真正变化的词。
// 纯函数，不依赖界面；DiffView 用它的结果在语法高亮的片段上叠加深色底。
import type { Segment } from './highlight'

export interface Range {
  start: number
  end: number
}

/** 超过这个长度的行不做词级比较（逐词比较是平方级） */
const MAX_LINE = 500

/** 中日韩字符一个字算一个词，其他按单词 / 连续空白 / 单个符号切 */
const TOKEN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{N}_])+|\s+|[^]/gu

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? []
}

const isBlank = (token: string): boolean => /^\s+$/.test(token)

/**
 * 一对删除 / 增加行（都已去掉行首的 -、+）里变化的字符区间。
 * 没有任何相同的词（整行重写）、或者太长时返回 null，这时只保留整行底色。
 */
export function pairRanges(before: string, after: string): { removed: Range[]; added: Range[] } | null {
  if (before.length > MAX_LINE || after.length > MAX_LINE || before === after) return null
  const a = tokenize(before),
    b = tokenize(after)
  const n = a.length,
    m = b.length
  // 最长公共子序列：dp[i][j] 是 a[i..] 与 b[j..] 的长度
  const dp = new Uint16Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
  const sameA = new Array<boolean>(n).fill(false),
    sameB = new Array<boolean>(m).fill(false)
  let shared = 0
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      sameA[i] = sameB[j] = true
      if (!isBlank(a[i])) shared++
      i++
      j++
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++
    else j++
  }
  if (shared === 0) return null
  return { removed: changedRanges(a, sameA), added: changedRanges(b, sameB) }
}

/** 没对上的词连成区间；两段之间只隔着空白时并成一段，看起来不碎 */
function changedRanges(tokens: string[], same: boolean[]): Range[] {
  const out: Range[] = []
  let pos = 0
  tokens.forEach((token, i) => {
    const end = pos + token.length
    if (!same[i]) {
      const last = out.at(-1)
      if (last && last.end === pos) last.end = end
      else out.push({ start: pos, end })
    } else if (isBlank(token) && out.at(-1)?.end === pos && i + 1 < tokens.length && !same[i + 1]) {
      out.at(-1)!.end = end
    }
    pos = end
  })
  return out
}

const isRemoved = (line: string): boolean => line.startsWith('-') && !line.startsWith('---')
const isAdded = (line: string): boolean => line.startsWith('+') && !line.startsWith('+++')

/**
 * 整段 diff（每行带 +/−/空格 前缀）里，相邻的删除段和增加段按位置配对，
 * 返回「行下标 → 这一行（去掉前缀后）变化的区间」。
 */
export function wordDiffRanges(lines: string[]): Map<number, Range[]> {
  const out = new Map<number, Range[]>()
  let i = 0
  while (i < lines.length) {
    if (!isRemoved(lines[i])) {
      i++
      continue
    }
    const delStart = i
    while (i < lines.length && isRemoved(lines[i])) i++
    const addStart = i
    while (i < lines.length && isAdded(lines[i])) i++
    const pairs = Math.min(addStart - delStart, i - addStart)
    for (let k = 0; k < pairs; k++) {
      const r = pairRanges(lines[delStart + k].slice(1), lines[addStart + k].slice(1))
      if (!r) continue
      if (r.removed.length) out.set(delStart + k, r.removed)
      if (r.added.length) out.set(addStart + k, r.added)
    }
  }
  return out
}

/** 把一行的高亮片段按变化区间切开，标出哪些片段属于变化的部分 */
export function cutSegments(segments: Segment[], ranges: Range[]): Array<Segment & { changed: boolean }> {
  const out: Array<Segment & { changed: boolean }> = []
  let pos = 0
  for (const seg of segments) {
    const segEnd = pos + seg.text.length
    let at = pos
    for (const r of ranges) {
      if (r.end <= at || r.start >= segEnd) continue
      if (r.start > at) out.push({ ...seg, text: seg.text.slice(at - pos, r.start - pos), changed: false })
      const end = Math.min(r.end, segEnd)
      out.push({ ...seg, text: seg.text.slice(Math.max(r.start, at) - pos, end - pos), changed: true })
      at = end
    }
    if (at < segEnd) out.push({ ...seg, text: seg.text.slice(at - pos), changed: false })
    pos = segEnd
  }
  return out
}
