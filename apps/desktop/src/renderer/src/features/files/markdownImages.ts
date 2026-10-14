import type { WorkspaceRef } from '../../../../shared/types/workspace'
import type { MarkdownImageSource } from '@/ui/markdown/MarkdownImage'
import { workspaceRelativePath } from './pathLinks'

/** 按会话所在机器读取，避免 Windows 窗口把 WSL 的 /home/... 当成本机图片地址。 */
export async function readMarkdownImage(ref: WorkspaceRef, path: string): Promise<MarkdownImageSource | null> {
  const relative = await workspaceRelativePath(ref, path)
  if (!relative) return null
  const doc = await window.pixelsky!.files.read(ref, relative)
  return doc.kind === 'image' ? { src: doc.dataUrl, bytes: doc.bytes } : null
}
