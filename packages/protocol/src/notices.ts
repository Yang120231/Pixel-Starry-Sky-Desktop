// 不影响使用的引擎警告（docs/ui/ai-commit-codex-warnings-history.md §3）：Codex 读到用户 config.toml 里
// 不认识的设置项、开了开发中的功能时，每轮都会发一条 warning。这类和哪一轮无关，不进对话：
// 引擎报给宿主，显示在设置 › 本机引擎 › Codex 的「配置提示」里；读出旧会话时把以前存下的去掉。
// 以后看到新的同类警告再加进来

import type { NoticeError, NoticeErrorKind } from './types/item'

const QUIET_WARNINGS: readonly [key: string, re: RegExp][] = [
  ['unrecognized', /^Codex is ignoring \d+ unrecognized configuration settings?\b/i],
  ['unstable', /^Under-development features? enabled\b/i],
]

/** 配置类警告属于哪一类；同一类新的一条替换旧的（例如改掉一个设置项后「忽略 2 个」变成「忽略 1 个」）。别的警告返回 null */
export function quietWarningKey(text: string): string | null {
  const head = text.trimStart()
  return QUIET_WARNINGS.find(([, re]) => re.test(head))?.[0] ?? null
}

/** 这条警告是不是只和用户自己的配置有关、不影响使用 */
export function isQuietWarning(text: string): boolean {
  return quietWarningKey(text) !== null
}

// ---------------------------------------------------------------------------
// 报错提示的归类（NoticeError.kind）：引擎填结构化的 kind，界面优先用它，没有时才按文字猜
// ---------------------------------------------------------------------------

const NOTICE_ERROR_KINDS: readonly NoticeErrorKind[] = ['auth', 'balance', 'route', 'busy', 'overflow']

/** 界面读到未知的 kind（以后新增的、别的版本写的）时当没有，退回按文字猜 */
export function isNoticeErrorKind(value: unknown): value is NoticeErrorKind {
  return typeof value === 'string' && (NOTICE_ERROR_KINDS as readonly string[]).includes(value)
}

/**
 * 引擎给的错误代码 → 归类，只有这一张表。Claude Code 的是合成消息里的 error 代码（claude/apiError.ts 的 ERROR_TEXT），
 * Codex 的是 TurnError.codexErrorInfo 的类型名——协议里是 camelCase（codex-cli 0.163.0 的
 * `codex app-server generate-json-schema` 里 CodexErrorInfo 的全部取值，下面逐个表过态）。
 * 没列的代码（invalid_request、max_output_tokens、badRequest、other……）不归类；
 * 同一个代码的特例（没有权限算 route、连不上不算 busy）由引擎按原文调整
 */
export const ERROR_CODE_KIND: Readonly<Record<string, NoticeErrorKind>> = {
  // Claude Code
  authentication_failed: 'auth',
  billing_error: 'balance',
  rate_limit: 'busy',
  overloaded: 'busy',
  server_error: 'busy',
  model_not_found: 'route',
  // Codex（CodexErrorInfo，camelCase）
  unauthorized: 'auth',
  usageLimitExceeded: 'balance',
  sessionBudgetExceeded: 'balance',
  rateLimitExceeded: 'busy',
  serverOverloaded: 'busy',
  internalServerError: 'busy',
  flexUnavailable: 'busy',
  contextWindowExceeded: 'overflow',
  // 其余不归类（写在这里是为了「逐个表过态」，不放进表）：
  //   httpConnectionFailed / responseStreamConnectionFailed / responseStreamDisconnected / responseTooManyFailedAttempts
  //     = 连接问题，和 Claude「连不上模型服务」一样不归类（带 4xx / 5xx 状态码时仍按状态码归）
  //   cyberPolicy / misalignmentPolicyViolation / tooManyDenials / badRequest / threadRollbackFailed /
  //   sandboxError / activeTurnNotSteerable / other = 与登录、余额、线路、繁忙、上下文无关
}

/** 原文里的 HTTP 状态码（只认 4xx / 5xx）；最后一条是 Pi 那种开头就是状态码的（「429 {"type":"error",…}」） */
const STATUS_IN_RAW = [
  /API Error:?\s*(?:Request rejected\s*)?\(?([45]\d\d)\b/i,
  /\bHTTP(?: status(?: code)?)?[ :]*([45]\d\d)\b/i,
  /\bstatus(?: code)?[ :=]+([45]\d\d)\b/i,
  /^\s*(?:Error:?\s*)?([45]\d\d)\b/i,
]
/** 认不出返回 undefined */
export function httpStatusOf(raw: string): number | undefined {
  for (const re of STATUS_IN_RAW) {
    const m = re.exec(raw)
    if (m) return Number(m[1])
  }
  return undefined
}

/**
 * HTTP 状态码 → 归类（和按文字猜时认的状态码一致）；别的状态码（400 等）不归类，交给原文。
 * 413 是请求体太大（Anthropic 的 request_too_large、本机网关的 32 MB 上限），和上下文超限一样压缩后能过；
 * 500 / 502 / 503 / 504 和 Claude Code 的 server_error 一样算繁忙（服务端暂时的问题，稍后重试）
 */
export function errorKindOfStatus(status: number | null | undefined): NoticeErrorKind | undefined {
  if (status === 401) return 'auth'
  if (status === 402) return 'balance'
  if (status === 403 || status === 404) return 'route'
  if (status === 413) return 'overflow'
  if (status === 429 || status === 529) return 'busy'
  if (status === 500 || status === 502 || status === 503 || status === 504) return 'busy'
  return undefined
}

/**
 * 上下文超限的各种说法：和 Pi（@earendil-works/pi-ai 的 utils/overflow.js）认的一致，再加 Codex 的
 * contextWindowExceeded / “ran out of room in the model's context window”、我们翻好的「上下文太长」。
 * 压缩失败的那句（上下文太长，自动压缩也没成功）不算：再压缩也没用；限流的话（“too many tokens per minute”）也不算
 */
const OVERFLOW: readonly RegExp[] = [
  /prompt (?:is )?too long/i, // Anthropic、z.ai、Ollama
  /prompt exceeds max length/i, // z.ai 国内
  /request_too_large/i, // Anthropic 按字节超限（HTTP 413）
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI（Responses / Chat Completions）
  /context[_ ]length/i, // context_length_exceeded、maximum context length、model's context length
  /maximum context/i,
  /maximum prompt length is \d+/i, // xAI
  /input token count.*exceeds the maximum/i, // Gemini
  /reduce the length of the messages/i, // Groq
  /exceeds (?:the )?maximum allowed input length/i, // OpenRouter / Poolside
  /token count of [\d,]+ exceeds the limit/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp
  /context window (?:exceeded|exceeds limit|is full)/i, // MiniMax 等
  /context_?window_?exceeded/i, // Codex contextWindowExceeded、z.ai model_context_window_exceeded
  /ran out of room in the model's context window/i, // Codex
  /exceeded model token limit/i, // Kimi
  /configured context size is/i, // DS4
  /range of input length should be/i, // DashScope / Qwen
  /too many tokens|token limit exceeded/i,
  /上下文(?:太长|超限|超出)/,
]
const COMPACTION_FAILED = /自动压缩也没成功|automatic compaction failed/i
/** 限流（每分钟 token 数之类），不是上下文超限（Pi 的 NON_OVERFLOW_PATTERNS） */
const RATE_LIMITED = /rate.?limit|too many requests|throttl|频繁/i

/** 这句话是不是在说上下文超限 */
export function isOverflowText(text: string): boolean {
  return OVERFLOW.some(re => re.test(text)) && !COMPACTION_FAILED.test(text) && !RATE_LIMITED.test(text)
}

/** 说清楚是余额 / 账单的（平台余额不足常用 403、429 报，OpenAI 的 insufficient_quota 是 429）：比状态码可靠 */
const BALANCE =
  /余额|欠费|充值|账单|额度(?:不足|已?用完)|billing|insufficient[_ ](?:balance|funds|credits?|quota)|insufficient_user_quota|exceeded your current quota|credit balance|out of credits|payment required|\bbalance\b|\b402\b/i
/** 余额的话能盖过这些状态码；401（登录）、404、5xx 照状态码 */
const BALANCE_STATUSES: ReadonlySet<number> = new Set([400, 402, 403, 429])

/** 只看文字的归类；status 是已知的状态码（没归上类的那些）：说「authentication」但状态码不是 401 时不算登录问题 */
function kindOfText(text: string, status: number | undefined): NoticeErrorKind | undefined {
  if (isOverflowText(text)) return 'overflow'
  if (
    status === undefined &&
    /登录已失效|已退出或切换|已改用自有|API Key 无效|authentication|unauthori[sz]ed|invalid api key|\b401\b/i.test(text)
  )
    return 'auth'
  if (BALANCE.test(text)) return 'balance'
  if (/分组|线路|找不到所选模型|没有权限|not available|model_not_found|forbidden|\b403\b|\b404\b/i.test(text))
    return 'route'
  if (/频繁|限额|繁忙|服务出错|rate.?limit|overloaded|too many requests|\b429\b|\b529\b/i.test(text)) return 'busy'
  // 只说 quota 的（“Quota exceeded”）多半是额度用完；带限流字样的上面已经算繁忙
  if (/quota/i.test(text)) return 'balance'
  return undefined
}

/**
 * 状态码 + 原文一起归类：说清楚是余额的盖过 400 / 403 / 429；明确的上下文超限盖过 5xx（有的中转把上游的超限包成 500）；
 * 其余已知的状态码优先于文字（限流提示里带 “too many tokens” 不能被当成上下文超限、403 里带 authentication 是没有权限）
 */
function kindOf(text: string, status: number | undefined): NoticeErrorKind | undefined {
  if ((status === undefined || BALANCE_STATUSES.has(status)) && BALANCE.test(text)) return 'balance'
  if ((status === undefined || status >= 500) && isOverflowText(text)) return 'overflow'
  return errorKindOfStatus(status) ?? kindOfText(text, status)
}

/**
 * 按错误文字归类（老会话、侧栏摘要和别的来源没有 NoticeError 时用）：Claude Code 的错误码已在引擎里翻成中文，
 * 平台代理 / 适配层返回中文或带 HTTP 状态码的原文；原文里的状态码和 noticeErrorOf 一样参与归类
 */
export function classifyErrorText(text: string): NoticeErrorKind | null {
  return kindOf(text, httpStatusOf(text)) ?? null
}

/**
 * 给 Codex、Pixel 这类只有代码 / 状态码 / 原文的来源用：代码表优先，其次状态码 + 原文（规则见 kindOf）；什么都没有时返回 undefined。
 * 已知的代码 / 状态码优先于文字：限流提示里带 “too many tokens” 之类的话不能被当成上下文超限
 */
export function noticeErrorOf(input: {
  code?: string | null
  status?: number | null
  text?: string
}): NoticeError | undefined {
  const code = input.code || undefined
  const status = typeof input.status === 'number' && input.status > 0 ? input.status : undefined
  const kind =
    (code ? ERROR_CODE_KIND[code] : undefined) ?? (input.text ? kindOf(input.text, status) : errorKindOfStatus(status))
  if (!kind && !code && status === undefined) return undefined
  return { ...(kind ? { kind } : {}), ...(code ? { code } : {}), ...(status !== undefined ? { status } : {}) }
}
