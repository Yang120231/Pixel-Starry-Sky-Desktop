// 产物面板（docs/ui/artifacts-panel.md）：AI 在工作区改过的文件（变更）和交给你的文件（交付）
import type { EngineId } from './types'

export interface ArtifactQuery {
  requestId: number
  projectId: string
  /** 工作区路径（由主进程解析，不接受渲染层传入） */
  workspace: string
  /** 最近几天，1–30 */
  days: number
}

export interface ArtifactFile {
  /** 改动记录里的原样路径（相对会话工作目录，或绝对路径） */
  path: string
  /** 换算后的绝对路径 */
  absolute: string
  /** 是否在当前工作区内 */
  inside: boolean
  /** 相对工作区的路径（用 / 分隔）；工作区外为 null */
  local: string | null
  kind: 'add' | 'update' | 'delete'
  added: number
  removed: number
  /** 最后一条改动记录，用来跳到对话 */
  itemId: string
  /** 这一轮改过这个文件的所有改动记录（按先后），看差异时逐条显示；行数是它们的合计 */
  itemIds: string[]
}

export interface ArtifactTurn {
  sessionId: string
  title: string
  engine: EngineId
  archived: boolean
  /** 这一轮的用户消息；会话开头没有用户消息时为 null */
  userItemId: string | null
  /** 用户消息摘要（最多 80 字） */
  prompt: string
  at: number
  /** 只含工作区内的文件 */
  files: ArtifactFile[]
}

export type DeliveryType = 'document' | 'image' | 'table' | 'web' | 'archive' | 'media'

export interface ArtifactDelivery {
  sessionId: string
  itemId: string
  title: string
  path: string
  absolute: string
  inside: boolean
  local: string | null
  type: DeliveryType | 'other'
  at: number
  exists: boolean
  bytes: number | null
}

export interface ArtifactResponse {
  requestId: number
  turns: ArtifactTurn[]
  delivered: ArtifactDelivery[]
  /** 工作区外被改过的不同文件数 */
  outsideCount: number
  truncated: boolean
  partial: boolean
}

const TYPES: Record<string, DeliveryType> = {}
for (const [type, exts] of Object.entries({
  document: 'md markdown txt pdf doc docx ppt pptx odt odp rtf epub',
  image: 'png jpg jpeg gif webp svg avif bmp ico',
  table: 'csv tsv xls xlsx ods',
  web: 'html htm',
  archive: 'zip 7z tar gz tgz rar bz2 xz',
  media: 'mp3 mp4 wav webm ogg m4a mov',
} as Record<DeliveryType, string>))
  for (const ext of exts.split(' ')) TYPES[ext] = type as DeliveryType

/** 按扩展名判断是不是「交付」类文件；源码、配置等返回 null */
export function deliveryType(path: string): DeliveryType | null {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return TYPES[name.slice(dot + 1).toLowerCase()] ?? null
}
