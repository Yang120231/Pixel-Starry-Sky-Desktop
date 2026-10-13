// EPUB 电子书 → 文字（docs/ui/composer-file-attachments.md §7.3）：META-INF/container.xml 指到 .opf，
// 按 spine 里的顺序读各章的 xhtml，每章转成正文（和网页一样）；开头写书名
import { htmlToText } from './html'
import { child, descendants, elements, parseXml, textOf } from './xml'
import { joinPath, type ZipEntries } from './zip'

export const EPUB_PARTS = (name: string): boolean =>
  name === 'mimetype' || name === 'META-INF/container.xml' || /\.(opf|xhtml|html?)$/i.test(name)

export const isEpub = (zip: ZipEntries): boolean =>
  zip.text('mimetype')?.trim() === 'application/epub+zip' || zip.has('META-INF/container.xml')

export function epubText(zip: ZipEntries): string {
  const container = zip.text('META-INF/container.xml')
  const opfPath = container ? descendants(parseXml(container), 'rootfile')[0]?.attrs['full-path'] : undefined
  const opfXml = opfPath && zip.text(opfPath)
  if (!opfPath || !opfXml) throw new Error('broken')
  const opf = parseXml(opfXml)
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  const hrefs = new Map<string, string>()
  for (const item of elements(child(opf, 'manifest'), 'item')) {
    let href = item.attrs.href ?? ''
    try {
      href = decodeURIComponent(href)
    } catch {
      // 保持原样
    }
    hrefs.set(item.attrs.id, joinPath(dir, href.replace(/#.*$/, '')))
  }
  const title = textOf(descendants(child(opf, 'metadata'), 'title')[0]).trim()
  const chapters = elements(child(opf, 'spine'), 'itemref')
    .filter(ref => ref.attrs.linear !== 'no')
    .map(ref => {
      const html = zip.text(hrefs.get(ref.attrs.idref) ?? '')
      return html ? htmlToText(html) : ''
    })
    .filter(Boolean)
  return [title && `# ${title}`, ...chapters].filter(Boolean).join('\n\n')
}
