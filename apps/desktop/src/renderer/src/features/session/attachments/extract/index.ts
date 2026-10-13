// 不是纯文本的文件：提取文字当文本附件发（docs/ui/composer-file-attachments.md §7）。按文件开头的字节认：
// zip 包里有 word/ xl/ ppt/ 的是 Word / Excel / PPT，mimetype 写着 OpenDocument / EPUB 的是那两种，其余是普通压缩包；
// OLE 复合文档是旧版 Office 或加了密码的新版 Office
import type { FileAttachment, FileSource } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { DOCX_PARTS, docxText } from './docx'
import { EPUB_PARTS, epubText, isEpub } from './epub'
import { ODF_PARTS, odfEncrypted, odfKind, odfText } from './odf'
import { PPTX_PARTS, pptxText } from './pptx'
import { XLSX_PARTS, xlsxText } from './xlsx'
import { UnzipTooLarge, unzipEntries } from './zip'
import { documentAttachment } from './document'

export { documentAttachment }

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

const wanted = (name: string): boolean =>
  DOCX_PARTS.includes(name) || XLSX_PARTS(name) || PPTX_PARTS(name) || ODF_PARTS.includes(name) || EPUB_PARTS(name)

/** 普通压缩包：说清楚不能直接加，列出里面前 50 个文件，方便知道该解压哪几个 */
export const ARCHIVE_LIST_LIMIT = 50
function archiveError(name: string, files: string[]): Error {
  const shown = files.slice(0, ARCHIVE_LIST_LIMIT).join(tr('composer.file.listSep'))
  const list = files.length
    ? `\n${tr('composer.file.archiveList', { p0: files.length, p1: shown + (files.length > ARCHIVE_LIST_LIMIT ? '…' : '') })}`
    : ''
  return new Error(tr('composer.file.archive', { p0: name }) + list)
}

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
  } catch (e) {
    if (e instanceof UnzipTooLarge) throw new Error(tr('composer.file.unzipTooLarge', { p0: file.name }))
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
  const odf = odfKind(zip)
  if (odf && odfEncrypted(zip)) throw new Error(tr('composer.file.encrypted', { p0: file.name }))
  if (odf) return extract(odf, () => odfText(zip, odf))
  if (isEpub(zip)) return extract('epub', () => epubText(zip))
  throw archiveError(file.name, zip.all)
}
