// 产物面板（docs/ui/artifacts-panel.md）

import type { ArtifactResponse, Item } from '@pixelsky/protocol'
import type { ArtifactPreview, ArtifactTarget } from '../shared/types/artifacts'

export interface ArtifactsBridge {
  /** 工作区（会话或项目）最近几天的改动和交付 */
  list(input: {
    requestId: number
    sessionId?: string
    projectId?: string
    days: number
  }): Promise<ArtifactResponse & { cancelled?: boolean }>
  /** 一条改文件记录（看差异用） */
  change(input: { sessionId: string; itemId: string }): Promise<Extract<Item, { kind: 'file_change' }> | null>
  read(target: ArtifactTarget): Promise<ArtifactPreview>
  /** 用系统默认应用打开（只限本机、只限文档类文件） */
  open(target: ArtifactTarget): Promise<void>
  reveal(target: ArtifactTarget): Promise<void>
}
