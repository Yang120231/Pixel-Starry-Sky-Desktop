// 反馈云端接口的薄客户端（docs/ui/feedback.md §4.1、§5）：snake_case → camelCase，时间转毫秒，非 2xx 转成带 code 的错误
import { feedbackFetch } from '../account/account'
import type {
  FeedbackAttachmentMeta,
  FeedbackAuthor,
  FeedbackDetail,
  FeedbackDiagnostics,
  FeedbackErrorSnippet,
  FeedbackList,
  FeedbackMessage,
  FeedbackStatus,
  FeedbackSummary,
  FeedbackThread,
  FeedbackType,
} from '../../shared/types/feedback'

export type FeedbackErrorCode = 'TOO_LARGE' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'NOT_DEPLOYED' | 'NOT_FOUND' | 'INVALID'

export class FeedbackError extends Error {
  constructor(
    message: string,
    readonly code: FeedbackErrorCode,
  ) {
    super(message)
    this.name = 'FeedbackError'
  }
}

const THREAD_ID = /^fb_[A-Za-z0-9]{8,32}$/

export function checkThreadId(id: unknown): string {
  if (typeof id !== 'string' || !THREAD_ID.test(id)) throw new FeedbackError('反馈编号不对', 'INVALID')
  return id
}

export function checkAttachmentId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new FeedbackError('附件编号不对', 'INVALID')
  return id
}

// ---------------------------------------------------------------------------
// 解析（逐字段防御）
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** RFC3339 → 毫秒；解析不了是 0 */
function time(v: unknown): number {
  if (typeof v !== 'string') return 0
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : 0
}

function timeOrNull(v: unknown): number | null {
  const ms = time(v)
  return ms > 0 ? ms : null
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

const TYPES = ['bug', 'feature', 'other'] as const satisfies readonly FeedbackType[]
const STATUSES = ['open', 'replied', 'closed'] as const satisfies readonly FeedbackStatus[]
const AUTHORS = ['user', 'team'] as const satisfies readonly FeedbackAuthor[]

export function parseSummary(v: unknown): FeedbackSummary | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null
  return {
    id: v.id,
    type: oneOf(v.type, TYPES, 'other'),
    title: str(v.title),
    status: oneOf(v.status, STATUSES, 'open'),
    createdAt: time(v.created_at),
    updatedAt: time(v.updated_at),
    unread: v.unread === true,
    preview: str(v.preview),
    previewAuthor: oneOf(v.preview_author, AUTHORS, 'user'),
  }
}

export function parseList(body: unknown): FeedbackList {
  const o = isObj(body) ? body : {}
  const threads = (Array.isArray(o.threads) ? o.threads : []).flatMap(t => parseSummary(t) ?? [])
  const unreadCount =
    typeof o.unread_count === 'number' && Number.isFinite(o.unread_count)
      ? Math.max(0, Math.floor(o.unread_count))
      : threads.filter(t => t.unread).length
  return { threads, unreadCount, nextBefore: typeof o.next_before === 'string' && o.next_before ? o.next_before : null }
}

function parseDiagnostics(v: unknown): FeedbackDiagnostics | null {
  if (!isObj(v)) return null
  return {
    appVersion: str(v.app_version),
    channel: str(v.channel),
    os: str(v.os),
    arch: str(v.arch),
    electron: str(v.electron),
    chrome: str(v.chrome),
    node: str(v.node),
    locale: str(v.locale),
    engines: (Array.isArray(v.engines) ? v.engines : []).flatMap(e =>
      isObj(e) ? [{ name: str(e.name), version: strOrNull(e.version), status: str(e.status) }] : [],
    ),
  }
}

function parseError(v: unknown): FeedbackErrorSnippet | null {
  if (!isObj(v)) return null
  return { text: str(v.text), sessionId: str(v.session_id), at: time(v.at) }
}

function parseAttachment(v: unknown): FeedbackAttachmentMeta | null {
  if (!isObj(v) || typeof v.id !== 'number' || !Number.isFinite(v.id)) return null
  const size = int(v.size)
  return {
    id: v.id,
    kind: v.kind === 'log' ? 'log' : 'image',
    name: str(v.name),
    mediaType: str(v.media_type),
    size,
    rawSize: typeof v.raw_size === 'number' && Number.isFinite(v.raw_size) ? v.raw_size : size,
    available: v.available !== false,
  }
}

function parseMessage(v: unknown): FeedbackMessage | null {
  if (!isObj(v) || typeof v.id !== 'number' || !Number.isFinite(v.id)) return null
  return {
    id: v.id,
    author: oneOf(v.author, AUTHORS, 'user'),
    kind: oneOf(v.kind, ['message', 'closed', 'reopened'] as const, 'message'),
    body: str(v.body),
    createdAt: time(v.created_at),
    diagnostics: parseDiagnostics(v.diagnostics),
    error: parseError(v.error),
    attachments: (Array.isArray(v.attachments) ? v.attachments : []).flatMap(a => parseAttachment(a) ?? []),
  }
}

export function parseDetail(body: unknown): FeedbackDetail {
  const o = isObj(body) ? body : {}
  const summary = parseSummary(o.thread)
  if (!summary || !isObj(o.thread)) throw new FeedbackError('云端返回的反馈数据异常', 'UNAVAILABLE')
  const thread: FeedbackThread = {
    ...summary,
    closedBy: o.thread.closed_by === 'user' || o.thread.closed_by === 'team' ? o.thread.closed_by : null,
    closedAt: timeOrNull(o.thread.closed_at),
  }
  return {
    thread,
    messages: (Array.isArray(o.messages) ? o.messages : []).flatMap(m => parseMessage(m) ?? []),
  }
}

// ---------------------------------------------------------------------------
// 发给云端的内容（camelCase → snake_case）
// ---------------------------------------------------------------------------

export interface WireClient {
  app_version: string
  channel: string
  os: string
  arch: string
  locale: string
}

export interface WireAttachment {
  kind: 'log' | 'image'
  name: string
  media_type: string
  encoding: 'gzip' | ''
  data_base64: string
}

export interface WireMessage {
  body: string
  client: WireClient
  diagnostics: ReturnType<typeof diagnosticsToWire> | null
  error: { text: string; session_id: string; at: string } | null
  attachments: WireAttachment[]
}

export function diagnosticsToWire(d: FeedbackDiagnostics) {
  return {
    app_version: d.appVersion,
    channel: d.channel,
    os: d.os,
    arch: d.arch,
    electron: d.electron,
    chrome: d.chrome,
    node: d.node,
    locale: d.locale,
    engines: d.engines.map(e => ({ name: e.name, version: e.version, status: e.status })),
  }
}

export function errorToWire(e: FeedbackErrorSnippet): { text: string; session_id: string; at: string } {
  return { text: e.text, session_id: e.sessionId, at: new Date(e.at).toISOString() }
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

async function errorOf(res: Response, listEndpoint: boolean): Promise<FeedbackError> {
  let message = ''
  try {
    const body: unknown = await res.json()
    if (isObj(body)) {
      if (typeof body.error === 'string') message = body.error
      else if (isObj(body.error) && typeof body.error.message === 'string') message = body.error.message
    }
  } catch {
    /* 响应体不是 JSON */
  }
  const s = res.status
  if (s === 413) return new FeedbackError(message || '内容太大，请去掉一些附件后重试', 'TOO_LARGE')
  if (s === 429) return new FeedbackError(message || '提交太频繁，请稍后再试', 'RATE_LIMITED')
  if (s === 404 && listEndpoint) return new FeedbackError(message || '反馈服务暂未开放', 'NOT_DEPLOYED')
  if (s === 404) return new FeedbackError(message || '这条反馈不存在', 'NOT_FOUND')
  if (s === 400) return new FeedbackError(message || '提交的内容不对', 'INVALID')
  return new FeedbackError(message || '反馈服务暂时不可用，请稍后再试', 'UNAVAILABLE')
}

/** 发请求并检查状态；网络错误、超时变成 UNAVAILABLE，登录过期（AUTH_EXPIRED）和未登录原样抛出 */
async function request(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  timeoutMs: number | undefined,
  listEndpoint = false,
): Promise<Response> {
  let res: Response
  try {
    res = await feedbackFetch(method, path, body, timeoutMs)
  } catch (e) {
    if (e instanceof FeedbackError) throw e
    const err = e as { code?: unknown; name?: unknown }
    if (err?.code === 'AUTH_EXPIRED') throw e
    if (e instanceof Error && !(e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError)) throw e
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new FeedbackError(timeout ? '请求超时，请稍后再试' : '连不上云端，请检查网络后重试', 'UNAVAILABLE')
  }
  if (res.ok) return res
  const error = await errorOf(res, listEndpoint)
  throw error
}

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    throw new FeedbackError('云端返回的数据异常', 'UNAVAILABLE')
  }
}

export async function listFeedback(before: string | null = null, limit = 20): Promise<FeedbackList> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (before) q.set('before', before)
  return parseList(await json(await request('GET', `/v1/feedback?${q}`, undefined, undefined, true)))
}

export async function createFeedback(
  input: WireMessage & { type: FeedbackType; title: string },
): Promise<FeedbackDetail> {
  return parseDetail(await json(await request('POST', '/v1/feedback', input, 90_000)))
}

export async function getFeedback(id: string): Promise<FeedbackDetail> {
  return parseDetail(await json(await request('GET', `/v1/feedback/${checkThreadId(id)}`, undefined, undefined)))
}

export async function replyFeedback(id: string, input: WireMessage): Promise<FeedbackDetail> {
  return parseDetail(await json(await request('POST', `/v1/feedback/${checkThreadId(id)}/messages`, input, 90_000)))
}

export async function closeFeedback(id: string): Promise<FeedbackDetail> {
  return parseDetail(await json(await request('POST', `/v1/feedback/${checkThreadId(id)}/close`, {}, undefined)))
}

/** 附件原始字节和云端给的类型（日志已是解压后的 text/plain） */
export async function fetchAttachment(
  threadId: string,
  attachmentId: number,
): Promise<{ bytes: Buffer; mediaType: string }> {
  const path = `/v1/feedback/${checkThreadId(threadId)}/attachments/${checkAttachmentId(attachmentId)}`
  const res = await request('GET', path, undefined, undefined)
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mediaType: (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase(),
  }
}
