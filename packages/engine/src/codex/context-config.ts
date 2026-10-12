// Codex 的上下文窗口和自动压缩（GitHub #20，docs/ui/context-settings-branch-switch.md §2.3）：
// Codex 的自动压缩配置要的是 token 数（model_auto_compact_token_limit），不是百分比，按窗口 × 百分比算
import { officialPrice, type ContextWindows, type SessionRecord } from '@pixelsky/protocol'

/** 自定义 API 的 Codex 会话：宿主把接口里这个模型填的窗口经环境变量带过来 */
export const CODEX_WINDOW_ENV = 'PIXELSKY_CODEX_CONTEXT_WINDOW'

export interface CodexContextInput {
  record: Pick<SessionRecord, 'platform' | 'provider'>
  /** 这个会话要用的模型；默认模型时是 Codex 报的当前模型，还不知道时为 null */
  model: string | null
  windows?: ContextWindows
  autoCompactPct?: number | null
  /** 宿主带来的自定义 API 窗口（CODEX_WINDOW_ENV） */
  providerWindow?: string
  /** Codex 之前报过的这个模型的窗口（没改窗口时记下的） */
  known?: number | null
}

/**
 * 启动 Codex 时要带的两项：window 是用户填的窗口，limit 是自动压缩的 token 数。
 * limit 的窗口依次取：填的、Codex 报过的、价格表里的；都没有就不带，由 Codex 自己决定
 */
export function codexContextConfig(input: CodexContextInput): { window: number | null; limit: number | null } {
  const { record, model } = input
  let window: number | null = null
  if (record.provider) {
    const n = Number(input.providerWindow)
    window = Number.isInteger(n) && n > 0 ? n : null
  } else if (model) window = input.windows?.[record.platform ? 'platform' : 'self'][model] ?? null
  const pct = input.autoCompactPct ?? null
  const base = window ?? input.known ?? (model ? (officialPrice(model)?.contextWindow ?? null) : null)
  return { window, limit: pct && base ? Math.round((base * pct) / 100) : null }
}
