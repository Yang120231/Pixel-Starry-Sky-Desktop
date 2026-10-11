// 日志（docs/ui/logging.md §4.6）：引擎包只定义接口和脱敏，写文件由主进程装进来的 sink 负责。
// 没装 sink 时什么都不做：测试、远端辅助进程不受影响。
import type { LogLevel } from '@pixelsky/protocol'

export type { LogLevel }
export type LogFields = Record<string, unknown>

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /** 这一级会不会记下来：详细日志关闭时 debug 为 false，调用方据此跳过拼装 */
  enabled(level: LogLevel): boolean
}

export interface LogSink {
  write(level: LogLevel, scope: string, message: string, fields?: LogFields): void
  enabled(level: LogLevel): boolean
}

let sink: LogSink | null = null

/** 主进程启动时装上；传 null 卸下（测试用） */
export function setLogSink(next: LogSink | null): void {
  sink = next
}

/** 按模块取日志器；每次调用都转给当前的 sink，所以可以在装 sink 之前创建 */
export function logger(scope: string): Logger {
  const write =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      if (!sink?.enabled(level)) return
      try {
        sink.write(level, scope, message, fields)
      } catch {
        // 日志出错不能影响业务
      }
    }
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    enabled: level => !!sink?.enabled(level),
  }
}

// ---------------------------------------------------------------------------
// 脱敏（§4.3）：写入前统一做
// ---------------------------------------------------------------------------

const SECRET_TEXT = [/\b(?:sk|pss|jc)[-_][A-Za-z0-9_-]{6,}/g, /\bBearer\s+[^\s"',;]+/gi]
const SECRET_PARAM =
  /([?&#](?:access_token|refresh_token|id_token|token|key|api_key|apikey|code|auth_code|code_challenge|code_verifier|state)=)[^&#\s"']+/gi
const SECRET_FIELD = /token|api_?key|authorization|password|passphrase|secret|cookie/i

export const REDACTED = '[redacted]'

/** 文本里的密钥、令牌、授权参数换成 [redacted] */
export function redact(text: string): string {
  let out = text
  for (const pattern of SECRET_TEXT) out = out.replace(pattern, REDACTED)
  return out.replace(SECRET_PARAM, `$1${REDACTED}`)
}

const MAX_STRING = 4000
const MAX_ITEMS = 50
const MAX_DEPTH = 4

/**
 * 字段脱敏并限制大小：字符串过 redact、超长截断；字段名像密钥的字符串值整个换成 ***（数字不动，
 * 例如 inputTokens）；Error 换成 { name, message, code, stack }；层级、数组长度有上限。
 */
export function sanitizeFields(fields: LogFields): LogFields {
  return sanitize(fields, 0) as LogFields
}

function sanitize(value: unknown, depth: number, key = ''): unknown {
  if (typeof value === 'string') {
    if (key && SECRET_FIELD.test(key)) return '***'
    const text = redact(value)
    return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…（共 ${text.length} 字）` : text
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (depth >= MAX_DEPTH) return '…'
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code
    return sanitize(
      {
        name: value.name,
        message: value.message,
        ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
        ...(value.stack ? { stack: value.stack.split('\n').slice(0, 12).join('\n') } : {}),
      },
      depth,
    )
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map(v => sanitize(v, depth + 1, key))
    if (value.length > MAX_ITEMS) items.push(`…（共 ${value.length} 项）`)
    return items
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD.test(k) && v !== null && typeof v !== 'number' && typeof v !== 'boolean') {
        out[k] = '***'
        continue
      }
      const next = sanitize(v, depth + 1, k)
      if (next !== undefined) out[k] = next
    }
    return out
  }
  return String(value)
}

/** 错误的代码和说明，沿 cause 链取，例如 "TypeError terminated ← UND_ERR_SOCKET other side closed" */
export function describeError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (typeof current === 'object') {
      const { code, message, name } = current as { code?: unknown; message?: unknown; name?: unknown }
      const part = [
        typeof code === 'string' || typeof code === 'number' ? String(code) : typeof name === 'string' ? name : '',
        typeof message === 'string' ? message : '',
      ]
        .filter(Boolean)
        .join(' ')
      if (part && !parts.includes(part)) parts.push(part)
      current = (current as { cause?: unknown }).cause
    } else {
      parts.push(String(current))
      break
    }
  }
  return redact(parts.join(' ← '))
}
