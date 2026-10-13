// 不是纯文本的文件：提取文字当文本附件发（docs/ui/composer-file-attachments.md §7）。按文件开头的字节认：
// zip 包里有 word/ xl/ ppt/ 的是 Word / Excel / PPT；OLE 复合文档是旧版 Office 或加了密码的新版 Office
import { FILE_INLINE_BYTES, type FileAttachment, type FileSource } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { DOCX_PARTS, docxText } from './docx'
import { PPTX_PARTS, pptxText } from './pptx'
import { XLSX_PARTS, xlsxText } from './xlsx'
import { unzipEntries } from './zip'

export type Container = 'zip' | 'ole'

/** 开头几个字节：PK\3\4 是 zip，D0 CF 11 E0 是 OLE 复合文档 */
export function containerOf(head: Uint8Array): Container | null {
  const begins = (...b: number[]): boolean => b.every((byte, i) => head[i] === byte)
  if (begins(0x50, 0x4b, 0x03, 0x04)) return 'zip'
  if (begins(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'ole'
  return null
}

const ext = (name: string): string => /\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? ''
const LEGACY: Record<string, [app: string, to: string]> = {
  doc: ['Word', '.docx'],
  xls: ['Excel', '.xlsx'],
  ppt: ['PowerPoint', '.pptx'],
}

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

const wanted = (name: string): boolean => DOCX_PARTS.includes(name) || XLSX_PARTS(name) || PPTX_PARTS(name)

/** 认出来、提取；认不出的格式给出能看懂的说法 */
export async function readDocument(file: File, container: Container): Promise<FileAttachment> {
  if (container === 'ole') {
    const legacy = LEGACY[ext(file.name)]
    if (legacy) throw new Error(tr('composer.file.legacyOffice', { p0: file.name, p1: legacy[0], p2: legacy[1] }))
    // 加了打开密码的 docx / xlsx / pptx 也是 OLE 包
    if (['docx', 'xlsx', 'pptx'].includes(ext(file.name)))
      throw new Error(tr('composer.file.encrypted', { p0: file.name }))
    throw new Error(tr('composer.file.binary', { p0: file.name }))
  }
  let zip
  try {
    zip = await unzipEntries(new Uint8Array(await file.arrayBuffer()), wanted)
  } catch {
    throw new Error(tr('composer.file.broken', { p0: file.name }))
  }
  const extract = (source: FileSource, fn: () => string): FileAttachment => {
    let text: string
    try {
      text = fn()
    } catch {
      throw new Error(tr('composer.file.broken', { p0: file.name }))
    }
    return documentAttachment(file, source, text)
  }
  if (zip.has('word/document.xml')) return extract('docx', () => docxText(zip))
  if (zip.has('xl/workbook.xml')) return extract('xlsx', () => xlsxText(zip))
  if (zip.has('ppt/presentation.xml')) return extract('pptx', () => pptxText(zip))
  throw new Error(tr('composer.file.archive', { p0: file.name }))
}
