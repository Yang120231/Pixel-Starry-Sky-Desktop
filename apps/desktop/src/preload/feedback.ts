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
}
