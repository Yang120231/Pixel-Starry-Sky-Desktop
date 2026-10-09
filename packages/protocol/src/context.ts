export interface ContextPart {
  name: string
  tokens: number
  kind: 'used' | 'buffer' | 'free'
}
export interface ContextDetail {
  name: string
  tokens: number
  source?: string
}
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

/** 仅接受原生结构化诊断，不根据人类可读表格或字符长度估算。 */
export function contextDiagnostic(value: unknown, now = Date.now()): ContextDiagnostic | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    typeof v.model !== 'string' ||
    !v.model ||
    !contextCount(v.total_tokens) ||
    !contextCount(v.raw_max_tokens) ||
    v.raw_max_tokens <= 0 ||
    !Array.isArray(v.categories)
  )
    return null
  const categories: ContextPart[] = []
  for (const row of v.categories) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.name !== 'string' ||
      !contextCount(row.tokens) ||
      !['used', 'buffer', 'free'].includes(row.kind)
    )
      return null
    categories.push({ name: row.name.slice(0, 200), tokens: row.tokens, kind: row.kind })
  }
  const details = (rows: unknown): ContextDetail[] =>
    Array.isArray(rows)
      ? rows.slice(0, 500).flatMap(row =>
          row && typeof row === 'object' && typeof row.name === 'string' && contextCount(row.tokens)
            ? [
                {
                  name: row.name.slice(0, 300),
                  tokens: row.tokens,
                  ...(typeof row.source === 'string' ? { source: row.source.slice(0, 100) } : {}),
                },
              ]
            : [],
        )
      : []
  return {
    model: v.model,
    used: v.total_tokens,
    window: v.raw_max_tokens,
    categories,
    tools: details(v.mcp_tools),
    memory: details(v.memory_files),
    agents: details(v.agents),
    skills: details(v.skills),
    observedAt: now,
  }
}
