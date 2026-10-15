import { EXT_LIMITS } from '@pixelsky/protocol/extpacks'
import type { TmTokenizer } from './engine'

export interface SampleMeasure {
  path: string
  /** 样例原本的行数 */
  sourceLines: number
  /** 实际测的行数（不足 stressLines 的样例循环补到 stressLines；超长行不测） */
  lines: number
  totalMs: number
  budgetMs: number
  slowestMs: number
  /** 最慢那行在样例里的原行号（1 起） */
  slowestLine: number
  /** 超过 lineMs 的行，按原行号去重，最慢的在前，最多 3 条 */
  slow: Array<{ line: number; ms: number }>
}

const MAX_SLOW = 3

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  // 末尾换行产生的空行不算
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 度量一个样例：先整份预热一遍，再测一遍（循环补到 stressLines 行，状态往下传）。
 * 超过 lineMs 的行从同一个起始状态再测 2 次取最小；总时间超预算再整遍重测一次取最小。
 * now 可注入，方便测试。
 */
export function measureSample(tok: TmTokenizer, text: string, path: string, now: () => number): SampleMeasure {
  const original = splitLines(text)
  const sourceLines = original.length
  // 要测的行：{原行号 0 起, 文本}；超长行不测（运行时也跳过）
  const stress: Array<{ at: number; text: string }> = []
  const count = sourceLines < EXT_LIMITS.stressLines ? EXT_LIMITS.stressLines : sourceLines
  for (let i = 0; i < count; i++) {
    const at = i % sourceLines
    const line = original[at]
    if (line.length <= EXT_LIMITS.lineChars) stress.push({ at, text: line })
  }
  const budgetMs = 1000 * Math.max(1, stress.length / 5000)
  const result: SampleMeasure = {
    path,
    sourceLines,
    lines: stress.length,
    totalMs: 0,
    budgetMs,
    slowestMs: 0,
    slowestLine: 0,
    slow: [],
  }
  if (stress.length === 0) return result

  // 预热：整份原样例走一遍
  let warm = tok.initial
  for (const line of original) {
    if (line.length <= EXT_LIMITS.lineChars) warm = tok.line(line, warm, EXT_LIMITS.sampleMs).state
  }

  const pass = (rerun: boolean): { total: number; per: number[] } => {
    let state = tok.initial
    let total = 0
    const per: number[] = []
    for (const { text: line } of stress) {
      const t0 = now()
      const r = tok.line(line, state, EXT_LIMITS.sampleMs)
      let ms = now() - t0
      total += ms
      if (rerun && ms > EXT_LIMITS.lineMs) {
        for (let k = 0; k < 2; k++) {
          const t1 = now()
          tok.line(line, state, EXT_LIMITS.sampleMs)
          ms = Math.min(ms, now() - t1)
        }
      }
      per.push(ms)
      state = r.state
    }
    return { total, per }
  }

  const first = pass(true)
  result.totalMs = first.total
  if (first.total > budgetMs) result.totalMs = Math.min(first.total, pass(false).total)

  const worst = new Map<number, number>()
  let slowestMs = -1
  let slowestAt = 0
  first.per.forEach((ms, i) => {
    const at = stress[i].at
    if (ms > slowestMs) {
      slowestMs = ms
      slowestAt = at
    }
    if (ms > EXT_LIMITS.lineMs) worst.set(at, Math.max(worst.get(at) ?? 0, ms))
  })
  result.slowestMs = Math.max(0, slowestMs)
  result.slowestLine = slowestAt + 1
  result.slow = [...worst.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_SLOW)
    .map(([at, ms]) => ({ line: at + 1, ms }))
  return result
}
