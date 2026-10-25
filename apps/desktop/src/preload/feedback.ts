// 设置 › 反馈（docs/ui/feedback.md §5）

import type {
  FeedbackAttachmentData,
  FeedbackChange,
  FeedbackCreateInput,
  FeedbackDetail,
  FeedbackList,
  FeedbackPreview,
  FeedbackPreviewQuery,
  FeedbackReplyInput,
  FeedbackState,
  FeedbackSummary,
} from '../shared/types/feedback'

export interface FeedbackBridge {
  /** 主进程缓存的状态（不联网） */
  state(): Promise<FeedbackState>
  /** 立即检查一次新回复 */
  refresh(): Promise<FeedbackState>
  /** 更早的一页；第一页用 state() 里的 */
  list(before: string | null): Promise<FeedbackList>
  /** 打开一条反馈（同时标记已读） */
  get(id: string): Promise<FeedbackDetail>
  create(input: FeedbackCreateInput): Promise<FeedbackDetail>
  /** 补充；已关闭的会重新打开 */
  reply(id: string, input: FeedbackReplyInput): Promise<FeedbackDetail>
  close(id: string): Promise<FeedbackDetail>
  /** 提交前预览将要发送的诊断信息和日志 */
  preview(query: FeedbackPreviewQuery): Promise<FeedbackPreview>
  attachment(threadId: string, attachmentId: number): Promise<FeedbackAttachmentData>
  onChange(cb: (change: FeedbackChange) => void): () => void
  /** 推过来、还没确认处理过的新回复（窗口打开前推的会丢，打开后取回） */
  pending(): Promise<FeedbackSummary[]>
  /** 这些新回复处理完了（弹了通知，或者按设置决定不弹）：记成已提醒 */
  ack(ids: string[]): Promise<void>
  /** 把所有未读反馈标为已读（只动用户侧；成功后主进程重新检查并推送新状态） */
  markAllRead(): Promise<void>
}
