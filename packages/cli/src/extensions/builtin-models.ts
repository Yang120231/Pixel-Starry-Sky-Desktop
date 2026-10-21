// 桌面端注册的网关模型（云端线路、自定义 API、子智能体单独的站点）只带模型名，Pi 当它是不认识的模型：
// 最大输出 16K、没有 xhigh / max 思考档位、窗口 128K。这里按 Pi 内置模型表里的同名模型补上（docs/own-cli.md §13）。
// 只补桌面端没写明的字段和桌面端自己猜的字段（INFERRED_ENV）；用户、接口配置里写明的不动。
// 只用可擦除的 TS 语法。

type Json = Record<string, unknown>

/** 桌面端猜的字段：{ provider: { 模型 id: ['reasoning', 'input', 'contextWindow'] } }，Pi 表里有值时以 Pi 的为准 */
export const INFERRED_ENV = 'PIXELSKY_PIXEL_INFERRED'

/** 只从官方厂商的目录里找（OpenRouter 之类的转售目录参数各不相同） */
const VENDORS = ['anthropic', 'openai', 'openai-codex', 'deepseek', 'xai', 'google', 'zai', 'moonshotai', 'mistral']

/** 和 API 无关的模型属性：桌面端没写明就用 Pi 表里的 */
const MODEL_FIELDS = ['contextWindow', 'maxTokens', 'reasoning', 'input'] as const

/**
 * 跟着模型走、不随接口厂商变的 compat：协议一样时，桌面端没写明的从 Pi 表继承。
 * - anthropic：opus-4-6 / sonnet-4-6 起的 Claude 只收自适应思考（按旧式 budget_tokens 发会被拒，xhigh / max 也用不上）；
 *   opus-4-7 起不收 temperature
 * - chat：DeepSeek、Kimi k3 开着思考调工具时，助手消息要带回 reasoning_content（经转售接口也一样）
 * 别的（strict 工具、mid-conversation 这类 beta）要看接口支不支持，不继承；桌面端认出是厂商官方接口时把 compat 标成猜的，
 * 这时和 Pi 自己一样以模型的 compat 为准
 */
const MODEL_COMPAT: Readonly<Record<string, readonly string[]>> = {
  'anthropic-messages': ['forceAdaptiveThinking', 'supportsTemperature'],
  'openai-completions': ['requiresReasoningContentOnAssistantMessages'],
}

const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}

const tokens = (id: string): string[] => id.toLowerCase().split('-').filter(Boolean)

/**
 * Pi 内置表里对应的模型：先按原名、去掉 [1m] 和日期后缀的名字找；找不到再找同一系列里名字的每一段都在这个名字里的
 * （deepseek-v4.1-flash → deepseek-flash），取段数最多的。同名的多个里协议一样的优先，再按厂商顺序
 */
export function findBuiltin(id: string, api: string, all: readonly Json[]): Json | undefined {
  const pool = all.filter(m => VENDORS.includes(String(m.provider)) && typeof m.id === 'string')
  const rank = (m: Json): number => (m.api === api ? 0 : 100) + VENDORS.indexOf(String(m.provider))
  const best = (list: Json[]): Json | undefined => [...list].sort((a, b) => rank(a) - rank(b))[0]
  const bare = id.replace(/\[1m\]$/i, '')
  const names = new Set([id, bare, bare.replace(/-\d{8}$/, '')])
  const exact = pool.filter(m => names.has(m.id as string))
  if (exact.length) return best(exact)
  const own = new Set(tokens(bare))
  const family = tokens(bare)[0]
  let found: Json[] = []
  let size = 1 // 至少要比系列名多一段，光有 deepseek 不算
  for (const m of pool) {
    const parts = tokens(m.id as string)
    if (parts[0] !== family || parts.length <= 1 || !parts.every(p => own.has(p))) continue
    if (parts.length > size) {
      size = parts.length
      found = [m]
    } else if (parts.length === size) found.push(m)
  }
  return best(found)
}

/** 协议一样时要继承的 compat：桌面端写明的优先；桌面端标了 compat 是猜的时 Pi 表里的优先。没有要改的返回 undefined */
function inheritedCompat(model: Json, api: string, builtin: Json, inferred: readonly string[]): Json | undefined {
  const theirs = builtin.api === api ? object(builtin.compat) : {}
  const own = object(model.compat)
  const picked: Json = {}
  for (const [key, value] of Object.entries(theirs))
    if (value !== undefined && (inferred.includes('compat') || (MODEL_COMPAT[api]?.includes(key) && !(key in own))))
      picked[key] = value
  return Object.keys(picked).length ? { ...own, ...picked } : undefined
}

/**
 * Pi 表里的最大输出可能和窗口一样大（Kimi k3 1M、Grok 4.5 起 500K）：Pi 按「窗口 − 估算 − 4096」发，中文估少了就超窗口被拒。
 * 继承来的最多给窗口的一半
 */
function cappedMaxTokens(maxTokens: unknown, window: unknown): unknown {
  return typeof maxTokens === 'number' && typeof window === 'number' && window > 0
    ? Math.min(maxTokens, Math.floor(window / 2))
    : maxTokens
}

/** 按内置模型补字段：没写的、桌面端猜的用内置的；思考档位、compat 只在协议一样时继承（不同协议的取值不通用） */
export function enrichModel(model: Json, api: string, builtin: Json | undefined, inferred: readonly string[]): Json {
  if (!builtin) return model
  const out: Json = { ...model }
  for (const field of MODEL_FIELDS)
    if (builtin[field] !== undefined && (model[field] === undefined || inferred.includes(field)))
      out[field] = builtin[field]
  if (out.maxTokens !== model.maxTokens) out.maxTokens = cappedMaxTokens(out.maxTokens, out.contextWindow)
  if (model.thinkingLevelMap === undefined && builtin.thinkingLevelMap && builtin.api === api)
    out.thinkingLevelMap = builtin.thinkingLevelMap
  const compat = inheritedCompat(model, api, builtin, inferred)
  if (compat) out.compat = compat
  return out
}

/** INFERRED_ENV 里某个 provider 的；格式不对当没有 */
export function inferredOf(env: NodeJS.ProcessEnv, provider: string): Record<string, string[]> {
  try {
    const all = JSON.parse(env[INFERRED_ENV] ?? '{}') as unknown
    const list = all && typeof all === 'object' ? (all as Record<string, unknown>)[provider] : null
    return list && typeof list === 'object' && !Array.isArray(list) ? (list as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}
