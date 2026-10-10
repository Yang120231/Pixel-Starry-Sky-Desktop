export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 当前上下文占用的 token 数 */
  contextTokens: number
  /** 上下文窗口大小；不知道时为 null */
  contextWindow: number | null
  /** 本会话累计花费（美元）；引擎不报告时为 null */
  costUsd: number | null
}

/** 一轮里一个模型的用量；四个 token 字段互不包含 */
export interface ModelTurnUsage {
  costSource?: import('../billing').CostSource
  billing?: import('../billing').BillingSource
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** 引擎报告的费用（美元）；不报告时为 null（例如 Codex） */
  costUsd: number | null
  /** 这一轮这个模型的请求次数 */
  requests?: number
}

/** 一轮的用量（docs/ui/usage.md §6.1） */
export interface TurnUsage {
  settlement?: import('../billing').PlatformSettlement
  /** 'official'：自定义 API 的会话，费用按官方模型定价估算（docs/ui/custom-api.md §4.3） */
  estimate?: 'official'
  /** 键是模型 id */
  models: Record<string, ModelTurnUsage>
  /** 这一轮总耗时（毫秒） */
  durationMs: number
}

export interface RequestCacheUsage {
  turnId: string
  messageId: string
  model: string
  input: number
  cacheRead: number
  cacheWrite: number
  observedAt: number
}

export interface RequestRetryState {
  turnId: string
  attempt: number | null
  maxRetries: number | null
  retryAt: number | null
  reason: string
}

export interface CacheWarning {
  sessionId: string
  turnId: string
  messageId: string
  title: string
  model: string
  input: number
  cached: number
  previousInput: number
  expiresAt: number
}
