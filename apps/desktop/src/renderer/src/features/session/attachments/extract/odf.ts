// OpenDocument（.odt / .ods / .odp，LibreOffice、WPS 能存）→ 文字（docs/ui/composer-file-attachments.md §7.3）：
// 都在 content.xml 里。文档按段落、标题、列表、表格、脚注写，和 Word 一样；表格每个表一节 CSV，和 Excel 一样；
// 演示文稿每页一节，和 PPT 一样
import type { FileSource } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { markdownTable } from './docx'
import { child, descendants, elements, first, parseXml, type XmlNode } from './xml'
import { compactRows, sheetSection } from './xlsx'
import type { ZipEntries } from './zip'

export const ODF_PARTS = ['mimetype', 'content.xml', 'META-INF/manifest.xml']

/** 存的时候设了密码：content.xml 是加密的，清单里写着 encryption-data */
export const odfEncrypted = (zip: ZipEntries): boolean =>
  !!zip.text('META-INF/manifest.xml')?.includes('encryption-data')

const TYPES: Record<string, FileSource> = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
}

/** 是哪一种：看 mimetype 文件（模板 .ott 这类也算） */
export function odfKind(zip: ZipEntries): FileSource | null {
  const type = zip
    .text('mimetype')
    ?.trim()
    .replace(/-template$/, '')
  return (type && TYPES[type]) || null
}

/** 段落里的字：空格 <text:s text:c="3"/>、制表、换行；脚注写成 [^1] 记下来，批注和图不要 */
function inline(node: XmlNode, notes: string[]): string {
  let out = ''
  for (const c of node.children) {
    if (typeof c === 'string') out += c
    else if (c.name === 's') out += ' '.repeat(Math.max(1, Number(c.attrs.c ?? 1)))
    else if (c.name === 'tab') out += '\t'
    else if (c.name === 'line-break') out += '\n'
    else if (c.name === 'note') {
      const body = elements(first(c, 'note-body'), 'p')
        .map(p => inline(p, notes))
        .join(' ')
        .trim()
      notes.push(body)
      out += `[^${notes.length}]`
    } else if (c.name !== 'annotation' && c.name !== 'frame' && c.name !== 'note-citation') out += inline(c, notes)
  }
  return out
}

/** 表格的行：表头行、行组里的也算；重复的行和格子展开（末尾大片空白的不展开） */
function tableRows(table: XmlNode, cell: (c: XmlNode) => string): (string[] | undefined)[] {
  const rows: (string[] | undefined)[] = []
  const walk = (n: XmlNode): void => {
    for (const r of elements(n)) {
      if (r.name !== 'table-row') {
        if (/^table-(header-rows|rows|row-group)$/.test(r.name)) walk(r)
        continue
      }
      const cells: string[] = []
      let blanks = 0
      for (const c of elements(r)) {
        if (c.name !== 'table-cell' && c.name !== 'covered-table-cell') continue
        const repeat = Math.max(1, Number(c.attrs['number-columns-repeated'] ?? 1))
        const value = c.name === 'table-cell' ? cell(c) : ''
        if (!value) {
          blanks += repeat
          continue
        }
        for (; blanks > 0; blanks--) cells.push('')
        for (let i = 0; i < Math.min(repeat, 1000); i++) cells.push(value)
      }
      const repeat = Math.max(1, Number(r.attrs['number-rows-repeated'] ?? 1))
      if (!cells.length) continue
      for (let i = 0; i < Math.min(repeat, 1000); i++) rows.push(cells)
    }
  }
  walk(table)
  return rows
}

/** 正文里的块：标题、段落、列表、表格、分节 */
function blocks(node: XmlNode, notes: string[], out: string[], depth = 0): void {
  for (const c of elements(node)) {
    if (c.name === 'h') {
      const text = inline(c, notes).trim()
      if (text) out.push(`${'#'.repeat(Math.min(6, Math.max(1, Number(c.attrs['outline-level'] ?? 1))))} ${text}`)
    } else if (c.name === 'p') {
      const text = inline(c, notes).trim()
      if (text) out.push(text)
    } else if (c.name === 'list') {
      for (const item of elements(c, 'list-item')) {
        const inner: string[] = []
        blocks(item, notes, inner, depth + 1)
        // 第一段写成「- 」；里面再套的列表已经按层缩进好了；同一项的其他段落缩进跟着
        const indent = '  '.repeat(depth)
        inner.forEach((line, i) =>
          out.push(i === 0 ? `${indent}- ${line}` : /^\s*- /.test(line) ? line : `${indent}  ${line}`),
        )
      }
    } else if (c.name === 'table') {
      const md = markdownTable(
        tableRows(c, cell =>
          elements(cell, 'p')
            .map(p => inline(p, notes).trim())
            .filter(Boolean)
            .join(' '),
        ).map(r => r ?? []),
      )
      if (md) out.push(md)
    } else if (c.name === 'section' || c.name === 'index-body' || c.name === 'list-header') blocks(c, notes, out, depth)
  }
}

function odtText(body: XmlNode): string {
  const notes: string[] = []
  const out: string[] = []
  blocks(body, notes, out)
  // 列表项一行一行挨着，其余块之间空一行
  let text = ''
  out.forEach((line, i) => {
    const listy = (s: string): boolean => /^\s*- |^\s{2,}/.test(s)
    if (i) text += listy(line) && listy(out[i - 1]) ? '\n' : '\n\n'
    text += line
  })
  if (notes.length) text += '\n\n' + notes.map((n, i) => `[^${i + 1}]: ${n}`).join('\n')
  return text
}

/** 单元格的值：日期用 office:date-value（2024-03-01），其余用显示出来的字（带格式的数字、百分比、货币） */
function odsCell(cell: XmlNode): string {
  if (cell.attrs['value-type'] === 'date' && cell.attrs['date-value'])
    return cell.attrs['date-value']
      .replace(/T00:00:00(\.0+)?$/, '')
      .replace('T', ' ')
      .replace(/:\d\d(\.\d+)?$/, '')
  return elements(cell, 'p')
    .map(p => inline(p, []))
    .join('\n')
}

function odsText(body: XmlNode): string {
  return elements(body, 'table')
    .map(table => sheetSection(table.attrs.name ?? '', compactRows(tableRows(table, odsCell))))
    .join('\n\n')
}

/** 文本框里的行：列表项写成 -（按层缩进） */
function frameLines(node: XmlNode, notes: string[], depth = 0): string[] {
  const lines: string[] = []
  for (const c of elements(node)) {
    if (c.name === 'p' || c.name === 'h') {
      const text = inline(c, notes).trim()
      if (text) lines.push(depth ? `${'  '.repeat(depth - 1)}- ${text}` : text)
    } else if (c.name === 'list')
      for (const item of elements(c, 'list-item')) lines.push(...frameLines(item, notes, depth + 1))
    else if (c.name === 'text-box' || c.name === 'list-header') lines.push(...frameLines(c, notes, depth))
  }
  return lines
}

function odpText(body: XmlNode): string {
  return elements(body, 'page')
    .map((page, i) => {
      let title = ''
      const lines: string[] = []
      const shapes = (n: XmlNode): void => {
        for (const c of elements(n)) {
          if (c.name === 'g') shapes(c)
          else if (c.name === 'notes') continue
          else if (c.name === 'frame' || c.name === 'custom-shape' || c.name === 'rect') {
            const cls = c.attrs.class
            const tbl = first(c, 'table')
            if (tbl) {
              const md = markdownTable(
                tableRows(tbl, cell =>
                  elements(cell, 'p')
                    .map(p => inline(p, []).trim())
                    .join(' '),
                ).map(r => r ?? []),
              )
              if (md) lines.push(md)
              continue
            }
            const text = frameLines(c, [])
            if (!title && cls === 'title') title = text.join(' ')
            else lines.push(...text)
          }
        }
      }
      shapes(page)
      const notes = descendants(first(page, 'notes'), 'frame')
        .filter(f => f.attrs.class === 'notes')
        .flatMap(f => frameLines(f, []))
        .join('\n')
      const heading = `## ${tr('composer.extract.slide', { p0: i + 1 })}${title ? `：${title}` : ''}`
      const out = [heading, ...lines]
      if (notes) out.push(`> ${tr('composer.extract.notes')}：${notes.replace(/\n/g, '\n> ')}`)
      return out.join('\n')
    })
    .join('\n\n')
}

export function odfText(zip: ZipEntries, kind: FileSource): string {
  const content = zip.text('content.xml')
  if (!content) throw new Error('broken')
  const body = child(parseXml(content), 'body')
  if (kind === 'ods') return odsText(child(body, 'spreadsheet') ?? body!)
  if (kind === 'odp') return odpText(child(body, 'presentation') ?? body!)
  return odtText(child(body, 'text') ?? body!)
}
