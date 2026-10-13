// 内存采样的间隔（docs/ui/renderer-memory.md §3.2.3）：主进程在回复里给下一次间隔

export const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 5_000
const MAX_INTERVAL_MS = 600_000

/** 主进程回复的下一次间隔：不是合理的数就用默认 */
export function nextInterval(reply: unknown): number {
  const ms = (reply as { intervalMs?: unknown } | null)?.intervalMs
  return typeof ms === 'number' && Number.isFinite(ms)
    ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms))
    : DEFAULT_INTERVAL_MS
}
