// 差异视图按「行」比对（docs/ui/coding-mode.md §3.3.3）：@codemirror/merge 默认按字符比对，一片很像的行（比如一串 import）
// 里插一行，后面的行会被错位配对、整段标成改动。这里先按行找出增删改的区块，只在「改了的行」里再按字符细分；
// 纯新增 / 纯删除的行交给 MergeView 在对面留空对齐（并排）或整行标出（行内）。
import { Change, diff, type DiffConfig } from '@codemirror/merge'

/** 行的起点偏移（多一个结尾），最后一行没有换行符时结尾就是全文长度 */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  if (starts[starts.length - 1] !== text.length) starts.push(text.length)
  return starts
}

/** 最后一行没有换行符时 lineStarts 的最后一项是全文长度；行数 = 起点数 - 1 */
const lineText = (text: string, starts: number[], i: number): string =>
  text.slice(starts[i], starts[i + 1]).replace(/\r?\n$/, '')

/** 每一行换成一个字符，用库自带的（带上限的 Myers）按字符比对算法比「行」；不同的行太多（> 6 万）时退回 null */
function diffLines(a: string[], b: string[]): readonly Change[] | null {
  const ids = new Map<string, string>()
  let next = 0x100
  const encode = (lines: string[]): string | null => {
    let out = ''
    for (const line of lines) {
      let id = ids.get(line)
      if (id === undefined) {
        if (next === 0xd800) next = 0xe000 // 跳过代理对区间，保证一行就是一个 UTF-16 单元
        if (next > 0xffff) return null
        id = String.fromCharCode(next++)
        ids.set(line, id)
      }
      out += id
    }
    return out
  }
  const ea = encode(a),
    eb = encode(b)
  if (ea === null || eb === null) return null
  return diff(ea, eb)
}

/** 改了的一对行：差得太多就整行算改，否则按字符细分（偏移换算成全文的） */
function pairChanges(lineA: string, lineB: string, offA: number, offB: number, out: Change[]): void {
  const inner = diff(lineA, lineB)
  const changed = inner.reduce((n, c) => n + Math.max(c.toA - c.fromA, c.toB - c.fromB), 0)
  if (changed > Math.max(lineA.length, lineB.length) * 0.6) {
    out.push(new Change(offA, offA + lineA.length, offB, offB + lineB.length))
    return
  }
  for (const c of inner) out.push(new Change(offA + c.fromA, offA + c.toA, offB + c.fromB, offB + c.toB))
}

/** 按行比对，返回全文偏移的改动；给 MergeView / unifiedMergeView 的 diffConfig.override 用 */
export function lineDiff(a: string, b: string): readonly Change[] {
  const sa = lineStarts(a),
    sb = lineStarts(b)
  const linesA = Array.from({ length: sa.length - 1 }, (_, i) => lineText(a, sa, i))
  const linesB = Array.from({ length: sb.length - 1 }, (_, i) => lineText(b, sb, i))
  const blocks = diffLines(linesA, linesB)
  if (!blocks) return diff(a, b)
  const out: Change[] = []
  for (const block of blocks) {
    // block 的 from / to 是行号区间 [fromA, toA)、[fromB, toB)
    const nA = block.toA - block.fromA,
      nB = block.toB - block.fromB
    const pairs = Math.min(nA, nB)
    for (let k = 0; k < pairs; k++) {
      const i = block.fromA + k,
        j = block.fromB + k
      pairChanges(linesA[i], linesB[j], sa[i], sb[j], out)
    }
    // 多出来的整行：新增（左边空）或删除（右边空），连同换行符一起
    if (nA > pairs || nB > pairs) {
      let fromA = sa[block.fromA + pairs],
        fromB = sb[block.fromB + pairs]
      const toA = sa[block.toA],
        toB = sb[block.toB]
      // 加在 / 删在文件末尾、而另一边最后一行没有换行符：把那一行结尾的换行算进这块改动，两边才对得上
      if (fromA === a.length && a && !a.endsWith('\n') && fromB > 0) fromB--
      else if (fromB === b.length && b && !b.endsWith('\n') && fromA > 0) fromA--
      out.push(new Change(fromA, toA, fromB, toB))
    }
  }
  return consistent(out, a.length, b.length) ? out : diff(a, b)
}

/** 改动之间没变的部分两边一样长才算对（例如只差末尾换行这种边角情况对不上时，退回按字符比对） */
function consistent(changes: readonly Change[], lenA: number, lenB: number): boolean {
  let posA = 0,
    posB = 0
  for (const c of changes) {
    if (c.fromA < posA || c.fromB < posB || c.fromA - posA !== c.fromB - posB) return false
    posA = c.toA
    posB = c.toB
  }
  return lenA - posA === lenB - posB
}

/** MergeView / unifiedMergeView 共用的比对设置 */
export const lineDiffConfig: DiffConfig = { override: lineDiff }
