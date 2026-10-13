// 从别处跳到设置 › 反馈（docs/ui/feedback.md §2.5）：先记下要打开的那一条 / 要预填的新反馈，反馈页打开后取走。照 logs/focus.ts
import type { FeedbackErrorSnippet, FeedbackType } from '../../../../shared/types/feedback'

/** 新反馈的预填：都可以省略（关于页的入口只打开空白表单） */
export interface FeedbackPrefill {
  type?: FeedbackType
  /** 从报错提示进来：出错片段（错误文字、会话编号、时间） */
  error?: FeedbackErrorSnippet
  /** 日志时间窗从这个时间起（「本轮出错前后」） */
  logsSince?: number
  /** 勾选最近日志（设置 › 日志的「提交给我们」） */
  logs?: boolean
}

export type FeedbackTarget = { threadId: string } | FeedbackPrefill

const EVENT = 'pixelsky:feedback-focus'
let pending: FeedbackTarget | null = null

/** 打开那一条反馈，或带预填打开新反馈；反馈页已经打开时立即生效 */
export function requestFeedback(target: FeedbackTarget): void {
  pending = target
  window.dispatchEvent(new Event(EVENT))
}

export function takeFeedbackFocus(): FeedbackTarget | null {
  const target = pending
  pending = null
  return target
}

/** 反馈页打开期间收到新的跳转请求 */
export function onFeedbackFocus(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}
