// 自定义 API 里上下文长度超过 200K 的模型（docs/ui/custom-api.md §10）：Claude Code 不认识的模型名最多按 200K 算，
// 模型名带 [1m] 才放开上限（发请求时它自己去掉后缀、加 context-1m beta 头），实际窗口再按 --settings 里
// modelSettings 的 autoCompactWindow 收到配置值。哪些模型要这样由宿主经会话环境变量给出，远程机器也一样带过去。
export const LONG_CONTEXT_ENV = 'PIXELSKY_LONG_CONTEXT_MODELS'

/** 发给 Claude Code 的模型名：在宿主给的名单里就加 [1m] */
export function claudeModelName(model: string, env: NodeJS.ProcessEnv): string {
  if (/\[1m\]$/i.test(model)) return model
  let list: unknown
  try {
    list = JSON.parse(env[LONG_CONTEXT_ENV] ?? '[]')
  } catch {
    return model
  }
  return Array.isArray(list) && list.includes(model) ? `${model}[1m]` : model
}

/** Claude Code 接受的自动压缩窗口范围；设置文件里超出范围的值会被整个忽略（退回 200K），所以先夹住 */
export const COMPACT_WINDOW_MIN = 100_000
export const COMPACT_WINDOW_MAX = 1_000_000
/** Claude Code 对不认识的模型名最多按这么大算；超过的要带 [1m] 才放得开 */
export const UNKNOWN_MODEL_WINDOW = 200_000

export type ModelSettings = Record<string, { autoCompactWindow: number }>

/**
 * 设置 › 模型与额度 / 本机引擎里给云端、本机模型填的上下文窗口（GitHub #20，docs/ui/context-settings-branch-switch.md §2.3）：
 * 和自定义 API 一样，超过 200K 的带 [1m]，按窗口写 modelSettings.autoCompactWindow
 */
export function windowSettings(windows: Readonly<Record<string, number>>): {
  long: string[]
  modelSettings: ModelSettings | null
} {
  const long: string[] = []
  const modelSettings: ModelSettings = {}
  for (const [model, n] of Object.entries(windows)) {
    if (!Number.isFinite(n) || n <= 0) continue
    if (n > UNKNOWN_MODEL_WINDOW) long.push(model)
    modelSettings[model] = {
      autoCompactWindow: Math.min(COMPACT_WINDOW_MAX, Math.max(COMPACT_WINDOW_MIN, Math.round(n))),
    }
  }
  return { long, modelSettings: Object.keys(modelSettings).length ? modelSettings : null }
}
