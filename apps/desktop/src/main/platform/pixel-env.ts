// 像素星空会话的网关环境变量（docs/own-cli.md §12）：按线路 / 接口的协议选 Pi 的 API 种类和本机地址。
// 不依赖 electron，单独测。
import type { ProviderModel, ProviderProtocol } from '../../shared/types/providers'
import type { PlatformGroupInfo } from '../../shared/types/platform-catalog'

export type PixelApi = 'anthropic-messages' | 'openai-responses' | 'openai-completions'

/**
 * 会话用哪种协议：自定义 API 看接口的协议；平台线路看分组的 platform（openai → Responses，其余 Anthropic Messages）。
 * 平台分组还没读到时按 Anthropic（和以前一样）。
 */
export function pixelApi(source: { protocol?: ProviderProtocol | null; groupPlatform?: string | null }): PixelApi {
  if (source.protocol === 'chat') return 'openai-completions'
  if (source.protocol === 'responses') return 'openai-responses'
  if (source.protocol === 'anthropic') return 'anthropic-messages'
  return source.groupPlatform === 'openai' ? 'openai-responses' : 'anthropic-messages'
}

/**
 * Pi 的 Anthropic 客户端自己补 /v1/messages，地址不带 /v1；OpenAI 的 SDK 把 /responses、/chat/completions 接在地址后面，
 * 所以 OpenAI 两种要带 /v1，网关收到的才是 /v1/responses、/v1/chat/completions（不会变成 /v1/v1/…）。
 */
export function pixelBaseUrl(api: PixelApi, port: number): string {
  return `http://127.0.0.1:${port}${api === 'anthropic-messages' ? '' : '/v1'}`
}

/**
 * Chat Completions 的兼容性：Pi 按 baseUrl 猜对方是谁，但我们给它的是本机网关地址，猜不出来，
 * 所以这里按真实接口地址显式写进 models.json 的 compat。保守默认：不发 store、不用 developer 角色、用 max_tokens（兼容接口都认）。
 */
export function chatCompat(upstreamBaseUrl: string | null): Record<string, unknown> {
  const deepseek = !!upstreamBaseUrl && /deepseek\.com/i.test(upstreamBaseUrl)
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
    supportsUsageInStreaming: true,
    ...(deepseek ? { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' } : {}),
  }
}

export function pixelGatewayEnv(options: {
  port: number
  secret: string
  api: PixelApi
  /** 自定义接口里的模型；平台线路没有，只用会话当前的 */
  models?: ProviderModel[]
  model: string | null
  /** 自定义接口的真实地址（只用来给 Chat Completions 选兼容性） */
  upstreamBaseUrl?: string | null
}): Record<string, string> {
  const compat = options.api === 'openai-completions' ? chatCompat(options.upstreamBaseUrl ?? null) : null
  const ids = (options.models ?? []).map(m => ({
    id: m.id,
    ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
  }))
  const list = ids.length ? ids : options.model ? [{ id: options.model }] : []
  // Chat Completions 的兼容接口多数不收图片，默认只给文字
  const models = compat ? list.map(m => ({ ...m, compat, input: ['text'] })) : list
  return {
    PIXELSKY_PIXEL_BASE_URL: pixelBaseUrl(options.api, options.port),
    PIXELSKY_PIXEL_TOKEN: options.secret,
    PIXELSKY_PIXEL_API: options.api,
    ...(models.length ? { PIXELSKY_PIXEL_MODELS: JSON.stringify(models) } : {}),
  }
}

/** 引擎能用哪些接口协议：像素星空三种都行，Claude Code 只要 Anthropic，Codex 只要 Responses */
export function engineProviderProtocols(engine: string): ProviderProtocol[] {
  return engine === 'codex' ? ['responses'] : engine === 'pixel' ? ['anthropic', 'responses', 'chat'] : ['anthropic']
}

/** 线路目录里这个分组能给哪个引擎用（没写 supported_engines 的按 platform 推：openai → Codex、像素星空；其余 → Claude Code、像素星空） */
export function groupEngines(group: Pick<PlatformGroupInfo, 'platform' | 'supported_engines'>): string[] {
  const engines = group.supported_engines ?? (group.platform === 'openai' ? ['codex', 'pixel'] : ['claude', 'pixel'])
  // 像素星空两种协议都会说：目录里写了 claude 或 codex 的线路它也能用
  return engines.includes('pixel') || !(engines.includes('claude') || engines.includes('codex'))
    ? engines
    : [...engines, 'pixel']
}
