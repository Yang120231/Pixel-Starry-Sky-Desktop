// 压缩上下文用的模型（docs/ui/plan-search-panes-compact.md §3）。
//
// Claude Code 没有「压缩用哪个模型」的设置，压缩时用的就是会话模型。它压缩时发的 /v1/messages
// 请求带固定的系统提示词，平台代理认出这类请求后把 model 换成用户为这个引擎选的压缩模型。
// 只对平台会话生效（自有会话直连官方，不经过我们的代理）。

/** Claude Code 压缩请求的系统提示词开头（2.1.x） */
export const CLAUDE_COMPACT_MARKER = 'You are a helpful AI assistant tasked with summarizing conversations'

function systemText(system: unknown): string {
  if (typeof system === 'string') return system
  if (!Array.isArray(system)) return ''
  return system
    .map(b =>
      b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
        ? (b as { text: string }).text
        : '',
    )
    .join('\n')
}

/** 这个请求体是不是 Claude Code 的压缩请求 */
export function isClaudeCompaction(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  return systemText((body as { system?: unknown }).system).includes(CLAUDE_COMPACT_MARKER)
}

/**
 * 压缩请求换模型：是压缩请求、选了压缩模型、和原模型不同、而且这条线路有这个模型时，返回改过的请求体；
 * 否则返回 null（原样转发）。线路没有这个模型时照常用会话模型，不报错。
 */
export function rewriteCompaction(
  raw: string,
  compactModel: string | null,
  routeModels: readonly string[],
): string | null {
  if (!compactModel || !routeModels.includes(compactModel)) return null
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isClaudeCompaction(body)) return null
  const b = body as { model?: unknown }
  if (b.model === compactModel) return null
  return JSON.stringify({ ...b, model: compactModel })
}
