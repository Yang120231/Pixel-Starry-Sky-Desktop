import { platformModelApi } from '../../shared/platform-models'

/**
 * DeepSeek / 智谱 / Kimi 这类线路：上游兼容 Messages，但没有 Claude 模型。Claude Code 默认请求 claude-* 名字
 * （主模型、sonnet / opus 别名、后台小模型），发过去会被拒，所以启动时把这些都指向线路里的模型，网关再兜底换一次。
 * 返回线路里能给 Claude Code 用的模型；线路有 Claude 模型、或者没有非官方命名的模型（OpenAI 分发线路）时返回空，不改。
 */
export function vendorModels(models: readonly string[]): string[] {
  if (models.some(m => platformModelApi(m) === 'messages')) return []
  return models.filter(m => platformModelApi(m) === null)
}

/** 后台小模型：名字像轻量版的（flash / mini / lite / air / turbo / haiku）优先，没有就用主模型 */
export function vendorSmallModel(models: readonly string[], main: string): string {
  return models.find(m => /(?:^|[-_.])(?:flash|mini|lite|air|turbo|haiku)(?:$|[-_.])/i.test(m)) ?? main
}

/**
 * 网关兜底：线路没有 Claude 模型时，Claude Code 请求的模型不在线路里就换掉——haiku 这类后台请求换成小模型，
 * 其他换成会话当前的模型（不在线路里就用第一个）。不用换时返回 null。
 */
export function vendorFallbackModel(
  models: readonly string[],
  requested: string | null,
  current: string | null | undefined,
): string | null {
  const usable = vendorModels(models)
  if (!usable.length || (requested && usable.includes(requested))) return null
  const main = current && usable.includes(current) ? current : usable[0]
  return requested && /haiku/i.test(requested) ? vendorSmallModel(usable, main) : main
}
