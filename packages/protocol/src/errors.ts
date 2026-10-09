// 宿主错误代码（docs/ui/files-search-terminal-pins.md §1）：主进程 / 引擎抛 codedError(code, params)，
// IPC 只传 message，所以代码和参数编码进 message（前缀 + JSON），界面按 errors.<code> 查词典翻译。
// 新代码用它；旧的中文句子错误保留，界面的反查翻译作为兜底。

export const ERROR_PREFIX = 'PIXELSKY_ERR:'

export type ErrorParams = Record<string, string | number>

export interface CodedErrorInfo {
  code: string
  params: ErrorParams
}

/** 带代码的错误；code 用点分小写（例如 files.exists），params 只放字符串和数字 */
export function codedError(code: string, params?: ErrorParams): Error {
  return new Error(ERROR_PREFIX + JSON.stringify(params ? { code, params } : { code }))
}

const CODED = /PIXELSKY_ERR:(\{[^\n]*?\})(?=$|\s|[,.;:，。；：）)])/g

function decode(json: string): CodedErrorInfo | null {
  try {
    const value = JSON.parse(json) as { code?: unknown; params?: unknown }
    if (typeof value.code !== 'string' || !value.code) return null
    const params: ErrorParams = {}
    if (value.params && typeof value.params === 'object' && !Array.isArray(value.params))
      for (const [key, v] of Object.entries(value.params))
        if (typeof v === 'string' || typeof v === 'number') params[key] = v
    return { code: value.code, params }
  } catch {
    return null
  }
}

/** 整条消息就是一个带代码的错误时返回代码和参数，否则 null */
export function parseCodedError(message: string | null | undefined): CodedErrorInfo | null {
  const value = (message ?? '').trim()
  if (!value.startsWith(ERROR_PREFIX)) return null
  return decode(value.slice(ERROR_PREFIX.length))
}

/** 把消息里所有带代码的错误片段换成 render 的结果（例如外层又拼了「启动失败：」前缀） */
export function replaceCodedErrors(message: string, render: (info: CodedErrorInfo) => string): string {
  if (!message.includes(ERROR_PREFIX)) return message
  return message.replace(CODED, (whole, json: string) => {
    const info = decode(json)
    return info ? render(info) : whole
  })
}
