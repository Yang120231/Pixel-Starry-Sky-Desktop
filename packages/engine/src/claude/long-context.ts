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
