// 压缩上下文条目的数字（docs/ui/compaction.md）
import type { CompactionProgress, Item, RequestRetryState } from '@pixelsky/protocol'

export type CompactionItem = Extract<Item, { kind: 'compaction' }>

/**
 * 进行中的压缩停在哪一步。经过本机网关的会话（平台、自定义 API）看得到细分：准备请求 → 等待上游接通 → 模型读取对话
 * → 输出摘要 → 整理上下文；直连官方的只有「等待模型」和重试
 */
export type CompactionPhase =
  | 'preparing'
  | 'connecting'
  | 'reading'
  | 'streaming'
  | 'finishing'
  | 'retrying'
  | 'upstreamError'
  | 'waiting'

/** 输出阶段这么久没有新内容算停住 */
export const STALL_MS = 15_000
/** 这么久之内收到过数据（含心跳）算连接还在 */
const HEARTBEAT_MS = 20_000
/** 等首字超过这么久、而且超过平时的 2.5 倍才提示比平时慢 */
const SLOW_MIN_MS = 25_000

export interface CompactionView {
  phase: CompactionPhase
  /** 输出停住了多久；没停住为 null */
  stalledMs: number | null
  /** 停住时连接还在（仍收到心跳） */
  heartbeat: boolean
  /** 等待上游接通 / 模型读取对话已经等了多久 */
  waitingMs: number | null
}

/**
 * progress：网关报来的进度（只有经过网关的才有）；retry：Claude Code 报的重试等待。
 * 网关上有一次请求还在进行时，按它的阶段显示（重试等待可能还没清掉）
 */
export function compactionView(
  progress: CompactionProgress | null,
  retry: RequestRetryState | null,
  gateway: boolean,
  now: number,
): CompactionView {
  const view = (phase: CompactionPhase, extra: Partial<CompactionView> = {}): CompactionView => ({
    phase,
    stalledMs: null,
    heartbeat: false,
    waitingMs: null,
    ...extra,
  })
  if (!progress) return view(retry ? 'retrying' : gateway ? 'preparing' : 'waiting')
  if (progress.error || (progress.status !== null && progress.status >= 400))
    return view(retry ? 'retrying' : 'upstreamError')
  if (progress.done) return view('finishing')
  if (progress.connectedAt === null) return view('connecting', { waitingMs: Math.max(0, now - progress.requestAt) })
  if (progress.firstTokenAt === null) return view('reading', { waitingMs: Math.max(0, now - progress.requestAt) })
  const quiet = now - (progress.lastContentAt ?? progress.firstTokenAt)
  return view('streaming', {
    stalledMs: quiet >= STALL_MS ? quiet : null,
    heartbeat: progress.lastByteAt !== null && now - progress.lastByteAt < HEARTBEAT_MS,
  })
}

/** 等首字等得比平时久：超过 25 秒，而且超过平时首字用时的 2.5 倍 */
export function waitingSlow(view: CompactionView, expectedFirstTokenMs: number): boolean {
  return view.waitingMs !== null && view.waitingMs > Math.max(SLOW_MIN_MS, expectedFirstTokenMs * 2.5)
}

/** 软进度（0~0.96）：还没出字时为 null（不推进，只来回扫）；输出时按已输出 / 平时的摘要长度，最多 92%；整理上下文时 96% */
export function compactionSoftProgress(
  phase: CompactionPhase,
  outputTokens: number,
  expectedOutput: number,
): number | null {
  if (phase === 'finishing') return 0.96
  if (phase !== 'streaming') return null
  return Math.min(0.92, outputTokens / Math.max(1, expectedOutput))
}

/** 输出速度（token/秒）：从首字到最近一次内容；太短时为 null */
export function compactionRate(progress: CompactionProgress): number | null {
  if (progress.firstTokenAt === null || progress.lastContentAt === null) return null
  const seconds = (progress.lastContentAt - progress.firstTokenAt) / 1000
  return seconds < 1 ? null : Math.round(progress.outputTokens / seconds)
}

/** 进行中的计时：0:07、1:42、1:02:05 */
export function compactionClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 压缩后占压缩前的比例（进度条宽度），两头都知道且压缩前大于 0 时才有；最小留一点，免得看不见 */
export function compactionRatio(item: Pick<CompactionItem, 'preTokens' | 'postTokens'>): number | null {
  const { preTokens: pre, postTokens: post } = item
  if (pre === null || post === null || pre <= 0) return null
  return Math.min(1, Math.max(0.02, post / pre))
}

/** 减少了百分之几（取整）；没变小时为 null */
export function compactionSaved(item: Pick<CompactionItem, 'preTokens' | 'postTokens'>): number | null {
  const { preTokens: pre, postTokens: post } = item
  if (pre === null || post === null || pre <= 0 || post >= pre) return null
  return Math.round((1 - post / pre) * 100)
}

/** 缓动（ease-out cubic）：t 是 0~1 的进度 */
export const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

/** 从 from 到 to 的缓动值，数字和进度条用同一条曲线 */
export function easeTokens(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOut(t))
}
