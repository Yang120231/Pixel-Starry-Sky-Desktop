// 发送失败后重试沿用同一个 clientMessageId（审查报告 2026-10-14）：消息可能已经进了电脑上的队列、只是回应丢了
// （断线、超时），换新 ID 电脑就认不出是重复，同一句话会执行两次。内容变了或发送成功后才换新的
export interface SendAttempt {
  /** 这次发的是什么（会话、文字、附件） */
  key: string
  id: string
}

/** 发送内容的标识：会话 + 文字 + 附件 */
export const sendKey = (target: string, text: string, attachmentIds: readonly string[]): string =>
  JSON.stringify([target, text, attachmentIds])

/** 同样的内容沿用上次的 ID，否则换新的 */
export const attemptFor = (last: SendAttempt | null, key: string, newId: () => string): SendAttempt =>
  last && last.key === key ? last : { key, id: newId() }
