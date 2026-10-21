import { describe, expect, it } from 'vitest'
import {
  ERROR_CODE_KIND,
  classifyErrorText,
  httpStatusOf,
  isOverflowText,
  noticeErrorOf,
  isQuietWarning,
  quietWarningKey,
} from '../src/notices'

describe('isQuietWarning', () => {
  it('认出 Codex 的配置类警告（单复数、前面有空白）', () => {
    expect(
      isQuietWarning(
        'Codex is ignoring 2 unrecognized configuration settings. Check for typos or deprecated settings.\n  user (~/.codex/config.toml): `x` is ignored.',
      ),
    ).toBe(true)
    expect(isQuietWarning('Codex is ignoring 1 unrecognized configuration setting.')).toBe(true)
    expect(
      isQuietWarning(
        '\nUnder-development features enabled: local_thread_store_compaction. Under-development features are incomplete.',
      ),
    ).toBe(true)
  })
  it('别的警告和报错不算', () => {
    expect(isQuietWarning('Model metadata for `gpt-x` not found.')).toBe(false)
    expect(isQuietWarning('Reconnecting... 1/5')).toBe(false)
    expect(isQuietWarning('提示：Codex is ignoring 2 unrecognized configuration settings')).toBe(false)
    expect(isQuietWarning('')).toBe(false)
  })
})

describe('quietWarningKey', () => {
  it('同一类警告的数量变了仍是同一类', () => {
    expect(quietWarningKey('Codex is ignoring 2 unrecognized configuration settings.')).toBe('unrecognized')
    expect(quietWarningKey('Codex is ignoring 1 unrecognized configuration setting.')).toBe('unrecognized')
    expect(quietWarningKey('Under-development features enabled: a, b.')).toBe('unstable')
    expect(quietWarningKey('Model metadata for `gpt-x` not found.')).toBeNull()
  })
})

// codex-cli 0.163.0 `codex app-server generate-json-schema` 里 CodexErrorInfo 的全部取值（camelCase）：
// 字符串枚举 + 带 httpStatusCode 的对象变体 + activeTurnNotSteerable。新版本多出来的值要在这里表态
const CODEX_ERROR_INFO: Record<string, 'auth' | 'balance' | 'route' | 'busy' | 'overflow' | undefined> = {
  contextWindowExceeded: 'overflow',
  sessionBudgetExceeded: 'balance',
  usageLimitExceeded: 'balance',
  rateLimitExceeded: 'busy',
  flexUnavailable: 'busy',
  serverOverloaded: 'busy',
  cyberPolicy: undefined,
  misalignmentPolicyViolation: undefined,
  tooManyDenials: undefined,
  internalServerError: 'busy',
  unauthorized: 'auth',
  badRequest: undefined,
  threadRollbackFailed: undefined,
  sandboxError: undefined,
  other: undefined,
  httpConnectionFailed: undefined,
  responseStreamConnectionFailed: undefined,
  responseStreamDisconnected: undefined,
  responseTooManyFailedAttempts: undefined,
  activeTurnNotSteerable: undefined,
}

describe('ERROR_CODE_KIND（Codex 的 CodexErrorInfo 是 camelCase）', () => {
  it('schema 里的每个取值都按约定归类，没列的不归类', () => {
    for (const [code, kind] of Object.entries(CODEX_ERROR_INFO)) {
      expect(ERROR_CODE_KIND[code], code).toBe(kind)
      expect(noticeErrorOf({ code, text: 'x' })?.kind, code).toBe(kind)
    }
  })

  it('表里没有 PascalCase 的老写法（真实协议不会发）', () => {
    for (const code of Object.keys(ERROR_CODE_KIND)) expect(code, code).not.toMatch(/^[A-Z]/)
  })

  it('连接类的错误带 4xx / 5xx 状态码时按状态码归，别的不归类', () => {
    expect(noticeErrorOf({ code: 'httpConnectionFailed', status: 429, text: 'x' })?.kind).toBe('busy')
    expect(noticeErrorOf({ code: 'responseStreamDisconnected', status: 502, text: 'x' })).toEqual({
      kind: 'busy',
      code: 'responseStreamDisconnected',
      status: 502,
    })
    expect(noticeErrorOf({ code: 'responseStreamDisconnected', status: 501, text: 'x' })).toEqual({
      code: 'responseStreamDisconnected',
      status: 501,
    })
    expect(noticeErrorOf({ code: 'httpConnectionFailed', text: 'error sending request' })).toEqual({
      code: 'httpConnectionFailed',
    })
  })
})

describe('上下文超限的文字和优先级', () => {
  it("认 Codex 的原句 “ran out of room in the model's context window”", () => {
    const text =
      "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying."
    expect(isOverflowText(text)).toBe(true)
    expect(classifyErrorText(text)).toBe('overflow')
    expect(noticeErrorOf({ code: 'contextWindowExceeded', text })?.kind).toBe('overflow')
    // 没带代码时按文字认
    expect(noticeErrorOf({ text })).toEqual({ kind: 'overflow' })
  })

  it('已知的代码 / 状态码优先于文字：限流提示里带 “too many tokens” 不算上下文超限', () => {
    const text = 'Rate limit reached: too many tokens per minute, context length unchanged'
    expect(noticeErrorOf({ code: 'rateLimitExceeded', text })?.kind).toBe('busy')
    expect(noticeErrorOf({ status: 429, text })?.kind).toBe('busy')
    // 代码不认识、也没有可归类的状态码，才退回文字
    expect(noticeErrorOf({ code: 'other', text: 'Too many tokens in the request' })?.kind).toBe('overflow')
    expect(noticeErrorOf({ code: 'badRequest', status: 400, text: 'maximum context length is 128000' })?.kind).toBe(
      'overflow',
    )
  })

  it('和 Pi 认的超限说法一致（OpenAI、Anthropic 413、Gemini、OpenRouter、llama.cpp…）', () => {
    for (const text of [
      'Your input exceeds the context window of this model. Please adjust your input and try again.',
      '413 {"type":"error","error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
      "Requested token count exceeds the model's maximum context length of 131072 tokens",
      'The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)',
      "This model's maximum prompt length is 131072 but the request contains 537812 tokens",
      'Please reduce the length of the messages or completion',
      'Input length 300000 exceeds the maximum allowed input length of 262144 tokens.',
      'prompt token count of 140000 exceeds the limit of 128000',
      'the request exceeds the available context size, try increasing it',
      'invalid params, context window exceeds limit',
      'Your request exceeded model token limit: 262144 (requested: 300000)',
      'Prompt has 140000 tokens, but the configured context size is 131072 tokens',
      'Range of input length should be [1, 129024]',
      'finish_reason: model_context_window_exceeded',
    ])
      expect(isOverflowText(text), text).toBe(true)
    // 限流（每分钟 token 数）不是超限
    expect(isOverflowText('Rate limit reached: too many tokens per minute')).toBe(false)
    expect(classifyErrorText('Rate limit reached: too many tokens per minute, context length unchanged')).toBe('busy')
    expect(isOverflowText('ThrottlingException: Too many tokens, please wait before trying again.')).toBe(false)
  })

  it('413 归上下文超限；明确的超限原文盖过 5xx（中转把上游的超限包成 500）', () => {
    expect(noticeErrorOf({ status: 413, text: 'Request exceeds size limit' })?.kind).toBe('overflow')
    expect(noticeErrorOf({ status: 500, text: 'upstream: prompt is too long: 213462 tokens > 200000' })?.kind).toBe(
      'overflow',
    )
    expect(noticeErrorOf({ status: 502, text: 'Bad Gateway' })?.kind).toBe('busy')
    expect(noticeErrorOf({ status: 503 })?.kind).toBe('busy')
  })
})

describe('余额、登录和状态码', () => {
  it('说清楚是余额的盖过 403 / 429 / 400（平台余额不足报 403，OpenAI insufficient_quota 是 429）', () => {
    expect(noticeErrorOf({ status: 403, text: '403 {"error":{"message":"Insufficient balance"}}' })?.kind).toBe(
      'balance',
    )
    expect(noticeErrorOf({ status: 403, text: '余额不足，请充值后重试' })?.kind).toBe('balance')
    expect(
      noticeErrorOf({
        status: 429,
        text: 'You exceeded your current quota, please check your plan and billing details.',
      })?.kind,
    ).toBe('balance')
    expect(
      noticeErrorOf({ status: 400, text: 'Your credit balance is too low to access the Anthropic API.' })?.kind,
    ).toBe('balance')
    // 只说 quota 的限流（每分钟配额）照状态码算繁忙
    expect(noticeErrorOf({ status: 429, text: 'Quota exceeded for metric: requests per minute' })?.kind).toBe('busy')
    // 5xx / 404 不被文字盖掉
    expect(noticeErrorOf({ status: 503, text: 'billing service unavailable' })?.kind).toBe('busy')
  })

  it('“insufficient permissions” 不是余额', () => {
    expect(
      classifyErrorText('You have insufficient permissions for this operation. Missing scopes: api.responses.write'),
    ).toBeNull()
    expect(noticeErrorOf({ status: 403, text: 'insufficient permissions' })?.kind).toBe('route')
  })

  it('原文说 authentication，但状态码不是 401 时按状态码（或不归类）', () => {
    expect(noticeErrorOf({ status: 403, text: 'authentication: key lacks access to this model' })?.kind).toBe('route')
    expect(noticeErrorOf({ status: 502, text: 'upstream authentication service failed' })?.kind).toBe('busy')
    expect(noticeErrorOf({ status: 400, text: 'authentication header malformed' })).toEqual({ status: 400 })
    expect(noticeErrorOf({ status: 401, text: 'authentication failed' })?.kind).toBe('auth')
    expect(noticeErrorOf({ text: 'authentication failed' })?.kind).toBe('auth')
  })

  it('按文字猜时也读原文里的状态码（侧栏、老会话）', () => {
    expect(classifyErrorText('API Error: 403 {"error":"insufficient balance"}')).toBe('balance')
    expect(classifyErrorText('HTTP 502: authentication proxy unavailable')).toBe('busy')
    expect(classifyErrorText('429 {"type":"error","error":{"type":"rate_limit_error"}}')).toBe('busy')
    expect(classifyErrorText('Error: 413 Request Entity Too Large')).toBe('overflow')
    expect(classifyErrorText('status code 400: authentication header malformed')).toBeNull()
    expect(httpStatusOf('429 {"type":"error"}')).toBe(429)
    expect(httpStatusOf('Error: 502 Bad Gateway')).toBe(502)
  })
})
