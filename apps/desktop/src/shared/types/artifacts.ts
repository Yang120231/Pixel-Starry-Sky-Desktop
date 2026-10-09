// 产物面板（docs/ui/artifacts-panel.md）

export type ArtifactPreview =
  | { kind: 'text'; content: string; truncated: boolean; bytes: number; format: 'plain' | 'markdown' | 'html' }
  | { kind: 'image'; dataUrl: string; bytes: number }
  | { kind: 'pdf'; base64: string; bytes: number }
  | { kind: 'unsupported'; reason: 'binary' | 'tooLarge'; bytes: number }
  | { kind: 'missing' }
/** 指向会话改动记录里的一个文件；path 是记录里的原样路径或换算后的绝对路径 */
export interface ArtifactTarget {
  sessionId: string
  path: string
}
