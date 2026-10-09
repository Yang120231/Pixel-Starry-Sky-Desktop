// 产物面板（docs/ui/artifacts-panel.md）
import type { ArtifactResponse, Item } from '@pixelsky/protocol'

export type ArtifactPreview =
  | { kind: 'text'; content: string; truncated: boolean; bytes: number; format: 'plain' | 'markdown' | 'html' }
  | { kind: 'image'; dataUrl: string; bytes: number }
  | { kind: 'pdf'; base64: string; bytes: number }
  | { kind: 'unsupported'; reason: 'binary' | 'tooLarge'; bytes: number }
  | { kind: 'missing' }

/** 指向会话改动记录里的一个文件；path 是记录里的原样路径或换算后的绝对路径 */
export interface ArtifactTarget { sessionId: string; path: string }

export interface ArtifactsBridge {
  /** 工作区（会话或项目）最近几天的改动和交付 */
  list(input: { requestId: number; sessionId?: string; projectId?: string; days: number }): Promise<ArtifactResponse & { cancelled?: boolean }>
  /** 一条改文件记录（看差异用） */
  change(input: { sessionId: string; itemId: string }): Promise<Extract<Item, { kind: 'file_change' }> | null>
  read(target: ArtifactTarget): Promise<ArtifactPreview>
  /** 用系统默认应用打开（只限本机、只限文档类文件） */
  open(target: ArtifactTarget): Promise<void>
  reveal(target: ArtifactTarget): Promise<void>
}
