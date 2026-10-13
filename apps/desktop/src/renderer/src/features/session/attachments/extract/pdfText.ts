// PDF → 文字（docs/ui/composer-file-attachments.md §7）：pdf.js 读每页的文字层，按页写「## 第 N 页」。
// 扫描件（没有文字层）、有打开密码的给说法。pdf.js 从外面传进来：界面里按需加载、带后台线程和中文用的 CMap（pdf.ts），
// 测试里用 Node 版
import { FILE_INLINE_BYTES } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'

/** pdf.js 里用到的那几样（不直接依赖它的类型，界面和测试各自传） */
export interface PdfJs {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocument>; destroy(): Promise<void> }
}
interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>
  destroy(): Promise<void>
}
interface TextItem {
  str: string
  hasEOL?: boolean
  transform?: number[]
}

export type PdfResult = { kind: 'text'; text: string } | { kind: 'scanned' } | { kind: 'password' }

/** 一页的文字：按 pdf.js 给的换行，没给时看纵坐标变了也换行 */
export function pageText(items: unknown[]): string {
  let out = ''
  let lastY: number | undefined
  for (const raw of items) {
    const item = raw as TextItem
    if (typeof item.str !== 'string') continue
    const y = item.transform?.[5]
    if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 1 && !out.endsWith('\n')) out += '\n'
    out += item.str
    if (item.hasEOL) out += '\n'
    if (y !== undefined) lastY = y
  }
  return out
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .join('\n')
    .trim()
}

/** 读文字；太长时读到够用就停（只带开头），开头写明一共几页、读了前几页 */
export async function pdfText(
  pdfjs: PdfJs,
  bytes: Uint8Array,
  options: Record<string, unknown> = {},
): Promise<PdfResult> {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, ...options })
  let doc: PdfDocument
  try {
    doc = await task.promise
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException') return { kind: 'password' }
    throw e
  }
  try {
    const pages: string[] = []
    let length = 0,
      read = 0,
      withText = 0
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const text = pageText((await page.getTextContent()).items)
      page.cleanup()
      read = n
      pages.push(`## ${tr('composer.extract.page', { p0: n })}\n${text || tr('composer.extract.noTextPage')}`)
      length += text.length
      if (text) withText++
      if (length > FILE_INLINE_BYTES) break
    }
    if (!withText) return { kind: 'scanned' }
    const note = read < doc.numPages ? `${tr('composer.extract.pdfPartial', { p0: doc.numPages, p1: read })}\n\n` : ''
    return { kind: 'text', text: note + pages.join('\n\n') }
  } finally {
    await doc.destroy()
  }
}
