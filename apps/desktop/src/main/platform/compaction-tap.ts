// 压缩上下文的实时进度：网关转发 Claude Code 的压缩请求时顺带读响应，把接通、首字、已输出多少、上游报错报给会话。
// 只读不改，转发的内容原样不动
import { randomUUID } from 'node:crypto'
import { CLAUDE_COMPACT_MARKER, isClaudeCompaction, type CompactionRequestReport } from '@pixelsky/engine'

/** 两次报告之间至少隔多久（接通、首字、结束这些节点不受限制） */
const REPORT_MS = 250
/** 报错的响应体最多读多少来找原因 */
const ERROR_BODY_MAX = 4096

/** 按字数估 token：ASCII 大约 4 个字符一个，其它（中文等）大约 1.5 个字一个 */
export function estimateTokens(ascii: number, other: number): number {
  return Math.round(ascii / 4 + other / 1.5)
}

/** 上游报错的响应体里的原因：Messages 的 { error: { message } }，读不出来时为 null */
function errorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown }
    const message =
      typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : typeof parsed.message === 'string'
            ? parsed.message
            : null
    return message?.trim().slice(0, 300) || null
  } catch {
    return null
  }
}

export class CompactionTap {
  private readonly state: CompactionRequestReport
  private ascii = 0
  private other = 0
  private errorBody = ''
  private lastReport = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly send: (report: CompactionRequestReport) => void,
    model: string | null,
    requestedModel: string | null,
    now = Date.now(),
  ) {
    this.state = {
      requestId: randomUUID(),
      model,
      requestedModel: requestedModel ?? model,
      requestAt: now,
      connectedAt: null,
      status: null,
      firstTokenAt: null,
      lastContentAt: null,
      lastByteAt: null,
      outputTokens: 0,
      outputExact: false,
      done: false,
      error: null,
    }
    this.flush()
  }

  /** 收到上游响应头 */
  response(status: number): void {
    this.state.connectedAt = Date.now()
    this.state.status = status
    this.flush()
  }

  /** 收到一块数据（含心跳） */
  touch(): void {
    this.state.lastByteAt = Date.now()
    this.schedule()
  }

  /** 报错的响应体：留前面一段，结束时读原因 */
  body(text: string): void {
    if (this.errorBody.length < ERROR_BODY_MAX) this.errorBody = (this.errorBody + text).slice(0, ERROR_BODY_MAX)
  }

  /** 一段完整的 SSE 事件 */
  sse(text: string): void {
    const first = this.state.firstTokenAt === null
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      let event: {
        type?: unknown
        delta?: Record<string, unknown>
        usage?: { output_tokens?: unknown }
        error?: unknown
      }
      try {
        event = JSON.parse(line.slice(5))
      } catch {
        continue
      }
      if (event.type === 'content_block_delta') {
        const delta = event.delta ?? {}
        const piece =
          typeof delta.text === 'string' ? delta.text : typeof delta.thinking === 'string' ? delta.thinking : ''
        if (!piece) continue
        for (const ch of piece) {
          if (ch.charCodeAt(0) < 128) this.ascii++
          else this.other++
        }
        const now = Date.now()
        this.state.firstTokenAt ??= now
        this.state.lastContentAt = now
        if (!this.state.outputExact) this.state.outputTokens = estimateTokens(this.ascii, this.other)
      } else if (event.type === 'message_delta') {
        const n = event.usage?.output_tokens
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
          this.state.outputTokens = n
          this.state.outputExact = true
        }
      } else if (event.type === 'error') {
        this.state.error = errorMessage(JSON.stringify(event)) ?? '上游返回错误'
      }
    }
    if (first && this.state.firstTokenAt !== null) this.flush()
    else this.schedule()
  }

  /** 发不出去 / 中途断开 */
  fail(message: string): void {
    if (this.state.done) return
    this.state.error = message.slice(0, 300)
    this.end()
  }

  /** 这次请求结束 */
  end(): void {
    if (this.state.done) return
    this.state.done = true
    const status = this.state.status
    if (status !== null && status >= 400 && !this.state.error) {
      const reason = errorMessage(this.errorBody)
      this.state.error = reason ? `HTTP ${status} · ${reason}` : `HTTP ${status}`
    }
    this.flush()
  }

  private schedule(): void {
    if (this.timer || this.state.done) return
    const wait = Math.max(0, this.lastReport + REPORT_MS - Date.now())
    this.timer = setTimeout(() => this.flush(), wait)
    this.timer.unref?.()
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.lastReport = Date.now()
    this.send({ ...this.state })
  }
}

/**
 * 是压缩请求就开一个 tap；不是（或没人收进度）时为 null。body 是转发出去的请求体（换过压缩模型的），
 * requested 是 Claude Code 原本请求的模型
 */
export function compactionTap(
  send: ((report: CompactionRequestReport) => void) | null,
  body: string,
  requested: unknown,
): CompactionTap | null {
  if (!send || !body.includes(CLAUDE_COMPACT_MARKER)) return null
  let parsed: { model?: unknown }
  try {
    parsed = JSON.parse(body) as { model?: unknown }
  } catch {
    return null
  }
  if (!isClaudeCompaction(parsed)) return null
  const model = typeof parsed.model === 'string' ? parsed.model : null
  return new CompactionTap(send, model, typeof requested === 'string' ? requested : model)
}
