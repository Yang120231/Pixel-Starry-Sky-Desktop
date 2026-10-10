// 自定义 API（docs/ui/custom-api.md）：主进程和设置页之间传的接口配置。Key 和附加请求头的值只在主进程里
export type ProviderProtocol = 'anthropic' | 'responses'
export type ProviderAuth = 'x-api-key' | 'bearer'
export type ProviderTemplate = 'anthropic' | 'openai' | 'custom'

export interface ProviderModel {
  id: string
  /** 上下文长度（token），选填 */
  contextWindow?: number | null
  /** 计价参照：按哪个官方模型估算费用；不填按模型名自动对 */
  priceRef?: string | null
}

/** 给设置页看的接口：Key 只剩末 4 位，请求头只给名字 */
export interface ProviderView {
  id: string
  name: string
  template: ProviderTemplate
  protocol: ProviderProtocol
  baseUrl: string
  auth: ProviderAuth
  models: ProviderModel[]
  /** 仅 Anthropic 协议：Claude Code 做标题、摘要等小任务用的模型；null 用列表第一个 */
  smallModel: string | null
  /** 请求的模型不在列表里时换成后台小模型或当前模型 */
  modelFallback: boolean
  /** Key 末 4 位；null 表示没有 Key（或系统加密不可用、重启后丢了） */
  keyHint: string | null
  headerNames: string[]
  /** 明文 http（只允许本机和内网） */
  insecure: boolean
  createdAt: number
  updatedAt: number
}

export interface ProviderInput {
  /** 没有 id 是新建 */
  id?: string
  name: string
  template?: ProviderTemplate
  protocol: ProviderProtocol
  baseUrl: string
  auth?: ProviderAuth
  models?: ProviderModel[]
  smallModel?: string | null
  modelFallback?: boolean
  /** 留空或不给表示不改 */
  apiKey?: string
  /** 附加请求头：值为 MASKED_SECRET 表示不改；不在这里的旧请求头删掉 */
  headers?: Record<string, string>
}

export interface ProvidersState {
  providers: ProviderView[]
  /** 系统加密可用：Key 会加密写盘；不可用时只在内存里，重启要重填 */
  persistent: boolean
  warning: string | null
}

export type ProviderProblem = 'auth' | 'quota' | 'model' | 'not_found' | 'timeout' | 'network' | 'redirect' | 'other'

export type ProviderTestResult =
  | { ok: true; status: number; model: string | null }
  | { ok: false; problem: ProviderProblem; status: number | null; message: string }
