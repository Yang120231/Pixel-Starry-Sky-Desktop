// 压缩上下文的预计用时、预计压缩比例、平时的首字用时和摘要长度（进度条、「比平时慢」用）：
// 按本机最近 20 次压缩的中位数估，没有记录时用默认值
import { median } from '@/ui/simulatedProgress'

const STORAGE = 'pixelsky.compactionHistory'
const KEEP = 20
export const DEFAULT_COMPACTION_MS = 30_000
export const DEFAULT_COMPACTION_RATIO = 0.25
export const DEFAULT_SUMMARY_TOKENS = 2_000
export const DEFAULT_FIRST_TOKEN_MS = 10_000

export interface CompactionSample {
  id: string
  preTokens: number
  durationMs: number
  ratio: number
  /** 经过本机网关时才有：首字用时、摘要输出的 token */
  firstTokenMs?: number
  outputTokens?: number
}

const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0

function valid(value: unknown): value is CompactionSample {
  const s = value as CompactionSample
  return (
    typeof s?.id === 'string' &&
    s.preTokens > 0 &&
    s.durationMs > 0 &&
    typeof s.ratio === 'number' &&
    s.ratio > 0 &&
    s.ratio <= 1 &&
    (s.firstTokenMs === undefined || positive(s.firstTokenMs)) &&
    (s.outputTokens === undefined || positive(s.outputTokens))
  )
}

export function loadSamples(): CompactionSample[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]')
    return Array.isArray(saved) ? saved.filter(valid).slice(-KEEP) : []
  } catch {
    return []
  }
}

/** 记一次看着压完的压缩；同一条只记一次 */
export function recordSample(sample: CompactionSample): void {
  if (!valid(sample)) return
  const samples = loadSamples()
  if (samples.some(s => s.id === sample.id)) return
  try {
    localStorage.setItem(STORAGE, JSON.stringify([...samples, sample].slice(-KEEP)))
  } catch {
    // 存不下就算了，下次照样用默认值
  }
}

/** 预计用时：每 1k token 的用时中位数 × 这次的 token 数 */
export function expectedDuration(preTokens: number | null, samples: readonly CompactionSample[]): number {
  if (preTokens === null || preTokens <= 0) return median(samples.map(s => s.durationMs)) ?? DEFAULT_COMPACTION_MS
  const perK = median(samples.map(s => s.durationMs / (s.preTokens / 1000)))
  return perK === null ? DEFAULT_COMPACTION_MS : Math.max(3_000, perK * (preTokens / 1000))
}

/** 预计压缩后占压缩前的比例 */
export function expectedRatio(samples: readonly CompactionSample[]): number {
  return median(samples.map(s => s.ratio)) ?? DEFAULT_COMPACTION_RATIO
}

/** 平时的摘要长度（输出 token），软进度条按它推进 */
export function expectedOutput(samples: readonly CompactionSample[]): number {
  return median(samples.flatMap(s => (s.outputTokens ? [s.outputTokens] : []))) ?? DEFAULT_SUMMARY_TOKENS
}

/** 平时等多久出首字，「比平时慢」按它判断 */
export function expectedFirstToken(samples: readonly CompactionSample[]): number {
  return median(samples.flatMap(s => (s.firstTokenMs ? [s.firstTokenMs] : []))) ?? DEFAULT_FIRST_TOKEN_MS
}
