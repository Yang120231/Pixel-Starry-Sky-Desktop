// 手机看 Git 改动（docs/mobile-remote.md §18.4）：电脑把两边的全文比成带上下文的 unified diff 再发，
// 不把两份全文都发过去（单帧 1 MB）。只有 @@ 行和 +/-/空格 开头的行，和会话里改动卡片的 diff 一样。

/** 逐行比对的规模上限（去掉相同的开头结尾后两边行数的乘积）：再大就当整段删了再加，免得卡住主进程 */
const MAX_CELLS = 2_000_000
/** 每处改动前后留几行 */
const CONTEXT = 3
/** 发给手机的 diff 最多这么多字符，再多截断 */
export const PHONE_DIFF_LIMIT = 400_000

export interface PhoneDiff {
  diff: string
  added: number
  removed: number
  /** 太长被截断了 */
  cut: boolean
}

type Line = readonly [' ' | '-' | '+', string]

const split = (text: string | null): string[] => {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** 中间不同的那段：最长公共子序列；太大时整段删再整段加 */
function middle(a: string[], b: string[]): Line[] {
  const out: Line[] = []
  if (!a.length || !b.length || a.length * b.length > MAX_CELLS) {
    for (const l of a) out.push(['-', l])
    for (const l of b) out.push(['+', l])
    return out
  }
  const n = a.length,
    m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0,
    j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push([' ', a[i++]])
      j++
    } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) out.push(['-', a[i++]])
    else out.push(['+', b[j++]])
  }
  return out
}

/** 两段全文（新文件 original 为 null，删除的 modified 为 null）→ 只含改动和前后几行的 diff */
export function phoneDiff(original: string | null, modified: string | null): PhoneDiff {
  const a = split(original),
    b = split(modified)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length,
    endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const lines: Line[] = [
    ...a.slice(0, start).map((l): Line => [' ', l]),
    ...middle(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((l): Line => [' ', l]),
  ]
  const changed: number[] = []
  lines.forEach(([t], i) => t !== ' ' && changed.push(i))
  // 每一行之前，两边各走到第几行（从 1 起）
  const oldAt = new Uint32Array(lines.length + 1),
    newAt = new Uint32Array(lines.length + 1)
  oldAt[0] = newAt[0] = 1
  lines.forEach(([t], i) => {
    oldAt[i + 1] = oldAt[i] + (t === '+' ? 0 : 1)
    newAt[i + 1] = newAt[i] + (t === '-' ? 0 : 1)
  })
  const out: string[] = []
  let size = 0,
    cut = false,
    added = 0,
    removed = 0
  for (const [t] of lines) {
    if (t === '+') added++
    else if (t === '-') removed++
  }
  for (let h = 0; h < changed.length && !cut; ) {
    // 相邻两处改动之间不超过两倍上下文就并成一段
    let k = h
    while (k + 1 < changed.length && changed[k + 1] - changed[k] <= 2 * CONTEXT + 1) k++
    const from = Math.max(0, changed[h] - CONTEXT),
      to = Math.min(lines.length, changed[k] + CONTEXT + 1)
    const hunk = [`@@ -${oldAt[from]},${oldAt[to] - oldAt[from]} +${newAt[from]},${newAt[to] - newAt[from]} @@`]
    for (let i = from; i < to; i++) hunk.push(lines[i][0] + lines[i][1])
    for (const line of hunk) {
      if (size + line.length + 1 > PHONE_DIFF_LIMIT) {
        cut = true
        break
      }
      out.push(line)
      size += line.length + 1
    }
    h = k + 1
  }
  return { diff: out.join('\n'), added, removed, cut }
}
