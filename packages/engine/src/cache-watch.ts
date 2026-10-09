import type { RequestCacheUsage } from '@pixelsky/protocol'

const MIN_INPUT = 1024
const MAX_GAP = 5 * 60_000
const valid = (n: number): boolean => Number.isSafeInteger(n) && n >= 0

/** 只比较同一主请求链的有效计数。首次、切换、输入缩短和长停顿重新建立基线。 */
export class CacheWatch {
  private previous: { input: number; at: number; model: string; route: string } | null = null

  reset(): void {
    this.previous = null
  }

  check(request: RequestCacheUsage, route: string): { input: number; previousInput: number } | null {
    if (
      !request.model ||
      ![request.input, request.cacheRead, request.cacheWrite].every(valid) ||
      !Number.isFinite(request.observedAt)
    ) {
      this.reset()
      return null
    }
    const input = request.input + request.cacheRead + request.cacheWrite
    if (!valid(input)) {
      this.reset()
      return null
    }
    const previous = this.previous
    this.previous = { input, at: request.observedAt, model: request.model, route }
    if (
      !previous ||
      input < MIN_INPUT ||
      previous.input < MIN_INPUT ||
      input < previous.input ||
      previous.model !== request.model ||
      previous.route !== route ||
      request.observedAt < previous.at ||
      request.observedAt - previous.at > MAX_GAP
    )
      return null
    return request.cacheRead < previous.input / 2 ? { input, previousInput: previous.input } : null
  }
}
