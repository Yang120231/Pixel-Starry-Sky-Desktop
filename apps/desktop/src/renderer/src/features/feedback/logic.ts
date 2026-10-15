// 反馈页的纯逻辑（docs/ui/feedback.md）：正文拼接、限额检查、日志时间窗、通知内容、错误文字。不依赖 window，可以直接单测。
import {
  FEEDBACK_LIMITS,
  type FeedbackDiagnostics,
  type FeedbackSummary,
  type FeedbackType,
} from '../../../../shared/types/feedback'
import { isQuiet, type NotificationPrefs } from '../notifications/policy'
import type { LogWindow } from './draft'

/** 「复现步骤」拼在正文末尾，服务端只认标题 + 正文 */
export function composeBody(body: string, steps: string, heading: string): string {
  const main = body.trim()
  const extra = steps.trim()
  return extra ? `${main}\n\n## ${heading}\n${extra}` : main
}

/** 不能提交的原因；null 表示可以。每项对应 feedback.limit.* */
export type LimitReason =
  | { code: 'titleEmpty' | 'bodyEmpty' | 'previewing' | 'previewFailed' }
  | { code: 'titleLong' | 'bodyLong' | 'images'; limit: number }

export function checkCreate(input: {
  title: string
  body: string
  images: number
  /** 拼好复现步骤的正文 */
  composed: string
}): LimitReason | null {
  const title = input.title.trim()
  if (!title) return { code: 'titleEmpty' }
  if ([...title].length > FEEDBACK_LIMITS.titleChars) return { code: 'titleLong', limit: FEEDBACK_LIMITS.titleChars }
  if (!input.body.trim()) return { code: 'bodyEmpty' }
  if ([...input.composed].length > FEEDBACK_LIMITS.bodyChars)
    return { code: 'bodyLong', limit: FEEDBACK_LIMITS.bodyChars }
  if (input.images > FEEDBACK_LIMITS.images) return { code: 'images', limit: FEEDBACK_LIMITS.images }
  return null
}

export function checkReply(input: { body: string; images: number }): LimitReason | null {
  if (!input.body.trim()) return { code: 'bodyEmpty' }
  if ([...input.body].length > FEEDBACK_LIMITS.bodyChars) return { code: 'bodyLong', limit: FEEDBACK_LIMITS.bodyChars }
  if (input.images > FEEDBACK_LIMITS.images) return { code: 'images', limit: FEEDBACK_LIMITS.images }
  return null
}

/** 报错片段按限额截断（服务端 ≤ 4000 字） */
export const clipErrorText = (text: string): string => [...text].slice(0, FEEDBACK_LIMITS.errorChars).join('')

const WINDOW_MS: Record<Exclude<LogWindow, 'around'>, number> = {
  '30m': 30 * 60_000,
  '2h': 2 * 3_600_000,
  '24h': 24 * 3_600_000,
}

/** 日志从什么时候起；「本轮出错前后」没有起点时退回 2 小时 */
export function windowSince(window: LogWindow, now: number, around: number | null): number {
  if (window === 'around') return around ?? now - WINDOW_MS['2h']
  return now - WINDOW_MS[window]
}

export function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export const TYPE_ORDER: FeedbackType[] = ['bug', 'feature', 'other']

/** 第一页（轮询拿到的）+ 手动加载的更早页，按 id 去重，第一页的数据优先 */
export function mergeThreads(first: FeedbackSummary[], older: FeedbackSummary[]): FeedbackSummary[] {
  const seen = new Set(first.map(t => t.id))
  return [...first, ...older.filter(t => !seen.has(t.id))]
}

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** 系统通知的内容：一次检查有多条只弹一条汇总；null = 没有新回复 */
export function freshNotice(fresh: FeedbackSummary[]): {
  id: string
  count: number
  body: string
  /** 应用内提示用：第一条的编号、标题、预览 */
  threadId: string
  title: string
  preview: string
} | null {
  const first = fresh[0]
  if (!first) return null
  const preview = first.preview.replace(/\s+/g, ' ').trim()
  return {
    id: `feedback:${first.id}`,
    count: fresh.length,
    body: clip(preview ? `${first.title}\n${preview}` : first.title, 300),
    threadId: first.id,
    title: first.title,
    preview: clip(preview, 120),
  }
}

/**
 * 怎么提醒（docs/ui/feedback-v2.md §4）：勿扰时不提醒；窗口在前台用应用内提示（右下角卡片），不在前台用系统通知。
 * 「仅在窗口不在前台时通知」管的是系统通知，不影响应用内提示。
 */
export type NoticeChannel = 'none' | 'toast' | 'system'
export function noticeChannel(prefs: NotificationPrefs, focused: boolean, now: number): NoticeChannel {
  if (isQuiet(prefs, new Date(now))) return 'none'
  return focused ? 'toast' : 'system'
}

/** 要不要弹系统通知：沿用通知设置的勿扰、「仅在窗口不在前台时通知」（团队聊天通知 TeamNotifier 也用它） */
export function shouldNotify(prefs: NotificationPrefs, focused: boolean, now: number): boolean {
  if (isQuiet(prefs, new Date(now))) return false
  return !(focused && prefs.unfocusedOnly)
}

/** 通知 id → 反馈 id；不是反馈通知返回 null */
export const threadOfNotification = (id: string): string | null => (id.startsWith('feedback:') ? id.slice(9) : null)

/** 诊断信息的文字版（线程里点开显示）；都是技术字段，不翻译 */
export function diagnosticsLines(d: FeedbackDiagnostics): string {
  const engines = d.engines.map(e => `  ${e.name} ${e.version ?? '-'} (${e.status})`)
  return [
    `app: ${d.appVersion} (${d.channel})`,
    `os: ${d.os} ${d.arch}`,
    `electron: ${d.electron}`,
    `chrome: ${d.chrome}`,
    `node: ${d.node}`,
    `locale: ${d.locale}`,
    ...(engines.length ? ['engines:', ...engines] : []),
  ].join('\n')
}

/** IPC 抛出的错误带着 "Error invoking remote method 'x': Error: " 前缀，去掉后才是给人看的原因 */
export function errorText(e: unknown): string {
  const raw = String((e as { message?: unknown } | null)?.message ?? e)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
}

/** 登录过期：切到未登录视图 */
export const isAuthExpired = (e: unknown): boolean => /AUTH_EXPIRED/.test(errorText(e))
