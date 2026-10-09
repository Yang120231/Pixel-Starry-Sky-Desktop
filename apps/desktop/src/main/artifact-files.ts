// 产物预览的文件读取（docs/ui/artifacts-panel.md §3–§4）。不依赖 Electron，SSH 辅助进程也会用。
// 调用方必须先确认路径在会话的改动记录里（EngineHost.recordedPath）。
import { open, realpath, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { deliveryType } from '@pixelsky/protocol'
import type { ArtifactPreview } from '../preload/artifacts'

export const ARTIFACT_TEXT_LIMIT = 512 * 1024
export const ARTIFACT_IMAGE_LIMIT = 8 * 1024 * 1024
export const ARTIFACT_PDF_LIMIT = 20 * 1024 * 1024
const IMAGES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' }
/** 可执行、脚本、快捷方式等：即使在改动记录里也不用默认应用打开 */
const BLOCKED = new Set(['.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.lnk', '.msi', '.msp', '.hta', '.scr', '.reg', '.url', '.jar', '.cpl', '.pif', '.sh', '.app', '.command', '.desktop', '.appimage', '.deb', '.rpm', '.dmg', '.pkg'])

/** 「用默认应用打开」只允许文档、图片、表格、网页、压缩包、媒体 */
export function openable(path: string): boolean {
  const ext = extname(path).toLowerCase()
  return !BLOCKED.has(ext) && deliveryType(path) !== null
}

async function readHead(file: string, max: number): Promise<{ data: Buffer; truncated: boolean }> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(max + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    return { data: buffer.subarray(0, Math.min(offset, max)), truncated: offset > max }
  } finally { await handle.close() }
}

export async function readArtifact(path: string): Promise<ArtifactPreview> {
  let file: string
  try { file = await realpath(path) } catch { return { kind: 'missing' } }
  const info = await stat(file)
  if (!info.isFile()) return { kind: 'missing' }
  const ext = extname(file).toLowerCase(), bytes = info.size
  if (IMAGES[ext]) {
    if (bytes > ARTIFACT_IMAGE_LIMIT) return { kind: 'unsupported', reason: 'tooLarge', bytes }
    const { data } = await readHead(file, ARTIFACT_IMAGE_LIMIT)
    return { kind: 'image', dataUrl: `data:${IMAGES[ext]};base64,${data.toString('base64')}`, bytes }
  }
  if (ext === '.pdf') {
    if (bytes > ARTIFACT_PDF_LIMIT) return { kind: 'unsupported', reason: 'tooLarge', bytes }
    const { data } = await readHead(file, ARTIFACT_PDF_LIMIT)
    return { kind: 'pdf', base64: data.toString('base64'), bytes }
  }
  const { data, truncated } = await readHead(file, ARTIFACT_TEXT_LIMIT)
  if (data.subarray(0, 8000).includes(0)) return { kind: 'unsupported', reason: 'binary', bytes }
  const content = data.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  return { kind: 'text', content, truncated, bytes, format: ext === '.md' || ext === '.markdown' ? 'markdown' : ext === '.html' || ext === '.htm' ? 'html' : 'plain' }
}
