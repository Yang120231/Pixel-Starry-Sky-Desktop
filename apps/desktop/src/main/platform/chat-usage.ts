// OpenAI Chat Completions 的网关辅助（docs/own-cli.md §12）：请求里补 include_usage，响应里读用量。
// 用量本身由像素星空命令行（Pi）从最后一个 chunk 读走并上报；网关这里只保证上游会发这个 chunk，并把数字记进日志。
export interface ChatUsage {
  input: number
  output: number
  cacheRead: number
}

/** 流式请求没要用量时补上 stream_options.include_usage（部分兼容接口不填就不返回 usage）；不是流式 / 已经有的原样返回 */
export function withUsageOption<T extends { stream?: unknown; stream_options?: unknown }>(parsed: T): T {
  if (parsed.stream !== true) return parsed
  const options =
    parsed.stream_options && typeof parsed.stream_options === 'object'
      ? (parsed.stream_options as Record<string, unknown>)
      : {}
  if (options.include_usage === true) return parsed
  return { ...parsed, stream_options: { ...options, include_usage: true } }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

function fromObject(value: unknown): ChatUsage | null {
  if (!value || typeof value !== 'object') return null
  const u = (value as { usage?: unknown }).usage
  if (!u || typeof u !== 'object') return null
  const usage = u as { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: unknown }
  const cached = num((usage.prompt_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens)
  return {
    input: Math.max(0, num(usage.prompt_tokens) - cached),
    output: num(usage.completion_tokens),
    cacheRead: cached,
  }
}

/** 从响应文本里读用量：非流式是一个 JSON；流式取最后一个带 usage 的 data 事件（usage 为 null 的 chunk 跳过） */
export function chatUsage(text: string): ChatUsage | null {
  try {
    const whole = fromObject(JSON.parse(text))
    if (whole) return whole
  } catch {
    /* 不是单个 JSON，按 SSE 读 */
  }
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const usage = fromObject(JSON.parse(data))
      if (usage) return usage
    } catch {
      /* 被截断的行 */
    }
  }
  return null
}
