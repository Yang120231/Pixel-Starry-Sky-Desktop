export interface ContextPart {
  name: string
  tokens: number
  /** deferred：延迟加载、还没放进上下文的工具，不计入占用 */
  kind: 'used' | 'buffer' | 'free' | 'deferred'
}
export interface ContextDetail {
  name: string
  tokens: number
  source?: string
}
/** summary：最近请求的计数加本地估算，不调接口；full：每类调 Token 计数接口 */
export type ContextDetailLevel = 'summary' | 'full'
export interface ContextDiagnostic {
  model: string
  used: number
  window: number
  categories: ContextPart[]
  tools: ContextDetail[]
  memory: ContextDetail[]
  agents: ContextDetail[]
  skills: ContextDetail[]
  observedAt: number
  /** 控制请求 get_context_usage 的精度；/context 得到的没有这个字段 */
  detail?: ContextDetailLevel
}
export interface ContextWindow {
  model: string | null
  used: number | null
  window: number | null
  input: number | null
  cacheRead: number | null
  cacheWrite: number | null
  output: number | null
  observedAt: number | null
  source: 'request' | 'diagnostic'
  stale: boolean
  compacting: boolean
  diagnostic: ContextDiagnostic | null
  diagnosticStale: boolean
}
export const contextCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/**
 * 仅接受原生结构化诊断，不根据人类可读表格或字符长度估算。
 * 兼容两种形状：`/context` 的 context_usage（下划线字段）和控制请求 get_context_usage 的回应（驼峰字段，
 * skills 是带 skillFrontmatter 的对象，记忆文件用 path、子智能体用 agentType、MCP 工具带 serverName）。
 */
export function contextDiagnostic(value: unknown, now = Date.now()): ContextDiagnostic | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const used = v.total_tokens ?? v.totalTokens,
    window = v.raw_max_tokens ?? v.rawMaxTokens ?? v.maxTokens
  if (typeof v.model !== 'string' || !v.model || !contextCount(used) || !contextCount(window) || window <= 0)
    return null
  if (!Array.isArray(v.categories)) return null
  const categories: ContextPart[] = []
  for (const row of v.categories) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.name !== 'string' ||
      !contextCount(row.tokens) ||
      !['used', 'buffer', 'free', 'deferred'].includes(row.kind)
    )
      return null
    categories.push({ name: row.name.slice(0, 200), tokens: row.tokens, kind: row.kind })
  }
  const text = (...values: unknown[]): string | null => {
    for (const value of values) if (typeof value === 'string' && value) return value
    return null
  }
  const details = (rows: unknown): ContextDetail[] =>
    Array.isArray(rows)
      ? rows.slice(0, 500).flatMap(row => {
          if (!row || typeof row !== 'object' || !contextCount(row.tokens)) return []
          const name = text(row.name, row.path, row.agentType, row.agent_type)
          const source = text(row.source, row.serverName, row.server_name, row.type)
          return name
            ? [{ name: name.slice(0, 300), tokens: row.tokens, ...(source ? { source: source.slice(0, 100) } : {}) }]
            : []
        })
      : []
  const skills = (raw: unknown): unknown =>
    Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? ((raw as Record<string, unknown>).skillFrontmatter ?? (raw as Record<string, unknown>).skill_frontmatter)
        : []
  return {
    model: v.model,
    used,
    window,
    categories,
    tools: details(v.mcp_tools ?? v.mcpTools),
    memory: details(v.memory_files ?? v.memoryFiles),
    agents: details(v.agents),
    skills: details(skills(v.skills)),
    observedAt: now,
  }
}
