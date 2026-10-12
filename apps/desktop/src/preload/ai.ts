import type { AiCommitRequest, AiCommitResult } from '../shared/types/ai'

/** AI 写提交信息（docs/ui/ai-commit-codex-warnings-history.md §2） */
export interface AiBridge {
  commitMessage(request: AiCommitRequest): Promise<AiCommitResult>
  /** 停止这次生成 */
  cancel(requestId: string): Promise<void>
  /** 云端这次实际扣了多少（美元）；还查不到时为 null */
  commitCharge(requestId: string): Promise<number | null>
}
