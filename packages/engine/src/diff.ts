// 生成显示用的 diff（只有 @@ 行和 +/-/空格 开头的行，没有文件头）

/** 超过这个规模就不逐行比对了，直接全删全加（避免大文件卡住主进程） */
const MAX_CELLS = 2_000_000

function splitLines(s: string): string[] {
  if (!s) return []
  const lines = s.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export interface DiffResult {
  diff: string
  added: number
  removed: number
}

/** 两段文本的逐行 diff（最长公共子序列），保留全部上下文行 */
export function diffText(oldText: string, newText: string): DiffResult {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const out: string[] = []
  if (a.length * b.length > MAX_CELLS) {
    for (const l of a) out.push(`-${l}`)
    for (const l of b) out.push(`+${l}`)
    return { diff: out.join('\n'), added: b.length, removed: a.length }
  }
  // dp[i][j] = a[i..] 和 b[j..] 的最长公共子序列长度
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push(` ${a[i]}`)
      i++
      j++
    } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      // 同样长度时先删后加，和常见的 diff 显示一致
      out.push(`-${a[i]}`)
      removed++
      i++
    } else {
      out.push(`+${b[j]}`)
      added++
      j++
    }
  }
  return { diff: out.join('\n'), added, removed }
}

/** 新文件：每行都是新增 */
export function diffAdded(content: string): DiffResult {
  const lines = splitLines(content)
  return { diff: lines.map(l => `+${l}`).join('\n'), added: lines.length, removed: 0 }
}

export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/** Claude Edit / Write 工具结果里的 structuredPatch */
export function diffFromHunks(hunks: PatchHunk[]): DiffResult {
  const out: string[] = []
  let added = 0
  let removed = 0
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
    for (const l of h.lines) {
      out.push(l)
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { diff: out.join('\n'), added, removed }
}
