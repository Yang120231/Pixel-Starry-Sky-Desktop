// Claude Code 的报错说人话（docs/ui/conversation-ux-2.md §2.1）。
// 实测：每次 API 报错它先发一条合成的助手消息（model 是 <synthetic>，带 error 代码，内容是一句英文），
// 再发 is_error 的结果，result 是同一句英文。这里按代码和英文原文给出提示的第一行，原文放进「详情」。

/** assistant 消息里 error 字段的说明 */
export const ERROR_TEXT: Record<string, string> = {
  authentication_failed: '登录已失效：在终端运行 claude auth login 重新登录',
  oauth_org_not_allowed: '当前账号的组织不允许使用 Claude Code',
  account_on_hold: '账号已被暂停',
  verification_required: '账号需要验证',
  billing_error: '账户余额或账单有问题',
  rate_limit: '请求太频繁，已触发限额',
  overloaded: '服务繁忙，请稍后再试',
  invalid_request: '请求无效',
  model_not_found: '找不到所选模型',
  server_error: '服务出错，通常是暂时的，稍后再试',
  max_output_tokens: '回复超过了最大长度',
  cloud_credential_error: '云服务凭据有问题',
}

const CJK = /[一-鿿]/
const UNREACHABLE =
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN|connection (?:refused|error|reset)|fetch failed|network error/i
const PERMISSION = /\b403\b|permission/i

/** 没有合成消息时（例如旧版本只给结果原文），从原文认出同样的错误类型；不像 API 报错的返回 null */
export function errorCodeFromText(raw: string): string | null {
  if (!/API Error|Invalid API key|authentication_error|Prompt is too long|overloaded|rate.?limit/i.test(raw))
    return null
  if (/\b40[13]\b|authentication_error|Invalid API key|Failed to authenticate/i.test(raw))
    return 'authentication_failed'
  if (/\b429\b|rate.?limit/i.test(raw)) return 'rate_limit'
  if (/Prompt is too long/i.test(raw)) return 'invalid_request'
  if (UNREACHABLE.test(raw) || /\b5\d\d\b|overloaded/i.test(raw)) return 'server_error'
  if (/\b404\b|not_found_error/i.test(raw)) return 'model_not_found'
  return null
}

/**
 * 一次 API 报错给用户看的那句；认不出时返回 null，照原文显示。
 * 原文里带中文的也返回 null：那是像素星空自己的平台网关、适配层写好的说明，换成通用的一句反而丢信息。
 */
export function friendlyApiError(code: string | null, raw: string): string | null {
  if (CJK.test(raw)) return null
  const c = code || errorCodeFromText(raw)
  if (!c) return null
  switch (c) {
    case 'authentication_failed':
      if (PERMISSION.test(raw)) return '没有权限：当前账号或 API Key 不能用这个模型或资源'
      if (/api[ -]?key/i.test(raw)) return 'API Key 无效：检查环境变量里的 ANTHROPIC_API_KEY'
      return ERROR_TEXT.authentication_failed
    case 'server_error':
      if (UNREACHABLE.test(raw)) return '连不上模型服务：检查网络、代理或防火墙'
      if (/\b529\b|overloaded/i.test(raw)) return ERROR_TEXT.overloaded
      return ERROR_TEXT.server_error
    case 'invalid_request':
      if (/Prompt is too long/i.test(raw)) return '上下文太长：先压缩（/compact）或开一个新会话'
      return ERROR_TEXT.invalid_request
    default:
      return ERROR_TEXT[c] ?? null
  }
}
