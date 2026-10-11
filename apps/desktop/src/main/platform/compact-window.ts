// 自定义 API 的上下文长度 → Claude Code 的自动压缩窗口（docs/ui/custom-api.md §9）。
// Claude Code 不认识的模型名一律按 200K 算、用到约 167K 才压缩；接口实际窗口更小时会先被拒「Prompt is too long」，
// 再拿整段超长对话去压缩，多半也失败。按模型写进 --settings 的 modelSettings：/model 换模型时跟着换，
// 用户自己设的 CLAUDE_CODE_AUTO_COMPACT_WINDOW 仍然优先。
import type { ProviderModel } from '../../shared/types/providers'

/** Claude Code 接受的范围；设置文件里超出范围的值会被整个忽略（退回 200K），所以这里先夹住 */
export const COMPACT_WINDOW_MIN = 100_000
export const COMPACT_WINDOW_MAX = 1_000_000

/** 远程机器：网关设置文件在远端写，按模型的设置借这个环境变量带过去，写文件时取出 */
export const MODEL_SETTINGS_ENV = 'PIXELSKY_GATEWAY_MODEL_SETTINGS'

export type ModelSettings = Record<string, { autoCompactWindow: number }>

/** 填了上下文长度的模型；都没填时为 null */
export function compactWindows(models: readonly ProviderModel[]): ModelSettings | null {
  const out: ModelSettings = {}
  for (const m of models) {
    const n = m.contextWindow
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    out[m.id] = { autoCompactWindow: Math.min(COMPACT_WINDOW_MAX, Math.max(COMPACT_WINDOW_MIN, Math.round(n))) }
  }
  return Object.keys(out).length ? out : null
}

/** 网关设置文件的内容；env 里带着的按模型设置取出来放到 modelSettings */
export function gatewaySettings(env: Record<string, string | undefined>): {
  env: Record<string, string | undefined>
  modelSettings?: ModelSettings
} {
  const { [MODEL_SETTINGS_ENV]: carried, ...rest } = env
  let modelSettings: ModelSettings | undefined
  try {
    const parsed: unknown = carried ? JSON.parse(carried) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) modelSettings = parsed as ModelSettings
  } catch {
    // 带过来的不是 JSON：不设窗口，照常启动
  }
  return modelSettings ? { env: rest, modelSettings } : { env: rest }
}
