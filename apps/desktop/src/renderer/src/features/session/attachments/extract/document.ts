// 提取出来的文字 → 文本附件（docs/ui/composer-file-attachments.md §7）
import { FILE_INLINE_BYTES, type FileAttachment, type FileSource } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'

const lineCount = (text: string): number => {
  let n = 0
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++
  return text && !text.endsWith('\n') ? n + 1 : n
}

/** 提取出来的文字 → 附件：太长只留开头（文档前面更要紧），写明后面省略了多少行 */
export function documentAttachment(
  file: { name: string; size: number },
  source: FileSource,
  raw: string,
): FileAttachment {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) throw new Error(tr('composer.file.noText', { p0: file.name }))
  const base = { id: crypto.randomUUID(), name: file.name, bytes: file.size, encoding: 'utf-8' as const, source }
  const lines = lineCount(text)
  if (text.length <= FILE_INLINE_BYTES) return { ...base, lines, text }
  const cut = text.lastIndexOf('\n', FILE_INLINE_BYTES - 1)
  const head = text.slice(0, cut > 0 ? cut + 1 : FILE_INLINE_BYTES)
  return { ...base, lines, text: head, tail: '', omitted: lines - lineCount(head) }
}
