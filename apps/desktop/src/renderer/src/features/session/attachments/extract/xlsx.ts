// Excel（.xlsx）→ 文字（docs/ui/composer-file-attachments.md §7）：每个工作表一节，按 CSV 写；公式带算好的值，
// 日期格式的数字转成日期；整行整列空的去掉；每个表最多带 200 行，写明一共多少行
import { tr } from '@/i18n/core'
import { child, elements, first, parseXml, textOf, type XmlNode } from './xml'
import { joinPath, type ZipEntries } from './zip'

export const SHEET_ROW_LIMIT = 200
export const XLSX_PARTS = (name: string): boolean =>
  name === 'xl/workbook.xml' ||
  name === 'xl/_rels/workbook.xml.rels' ||
  name === 'xl/sharedStrings.xml' ||
  name === 'xl/styles.xml' ||
  /^xl\/worksheets\/[^/]+\.xml$/.test(name)

/** 列字母 → 下标：A → 0、AA → 26 */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Excel 日期序号 → 2024-03-01（带时间时加上 hh:mm） */
export function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const iso = new Date(ms).toISOString()
  return serial % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

const BUILTIN_DATES = new Set([14, 15, 16, 17, 22])
const BUILTIN_TIMES = new Set([18, 19, 20, 21, 45, 46, 47])
type Kind = 'date' | 'time' | null

/** 单元格样式是不是日期 / 时间：内置格式，或自定义格式里有年月日（只有时分秒的算时间；去掉引号里的字和颜色） */
function dateStyles(styles: XmlNode | null): Kind[] {
  const custom = new Map<number, string>()
  for (const f of elements(child(styles ?? undefined, 'numFmts'), 'numFmt'))
    custom.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? '')
  return elements(child(styles ?? undefined, 'cellXfs'), 'xf').map(xf => {
    const id = Number(xf.attrs.numFmtId ?? 0)
    if (BUILTIN_DATES.has(id)) return 'date'
    if (BUILTIN_TIMES.has(id)) return 'time'
    const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
    if (/[yd]/i.test(code)) return 'date'
    return /h/i.test(code) && /[ms]/i.test(code) ? 'time' : null
  })
}

/** 一天里的时间：0.5 → 12:00 */
export function excelTime(serial: number): string {
  const minutes = Math.round((serial % 1) * 1440) % 1440
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function sheetRows(sheet: XmlNode, strings: string[], dates: Kind[]): string[][] {
  const rows: string[][] = []
  for (const row of elements(child(sheet, 'sheetData'), 'row')) {
    const r = Number(row.attrs.r ?? rows.length + 1) - 1
    const cells: string[] = []
    let next = 0
    for (const c of elements(row, 'c')) {
      const col = c.attrs.r ? columnIndex(c.attrs.r) : next
      next = col + 1
      const v = textOf(first(c, 'v'))
      let value: string
      if (c.attrs.t === 's') value = strings[Number(v)] ?? ''
      else if (c.attrs.t === 'inlineStr') value = textOf(first(c, 'is'))
      else if (c.attrs.t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : v
      else if (c.attrs.t === 'str' || c.attrs.t === 'e') value = v
      else if (v !== '' && dates[Number(c.attrs.s ?? 0)] && Number.isFinite(Number(v)))
        value = dates[Number(c.attrs.s ?? 0)] === 'time' ? excelTime(Number(v)) : excelDate(Number(v))
      else value = v
      cells[col] = value
    }
    rows[r] = cells
  }
  // 去掉整行空的、整列空的
  const filled = rows.filter(r => r?.some(v => v?.trim()))
  const width = Math.max(0, ...filled.map(r => r.length))
  const used = Array.from({ length: width }, (_, i) => filled.some(r => r[i]?.trim()))
  return filled.map(r => used.flatMap((u, i) => (u ? [r[i] ?? ''] : [])))
}

export function xlsxText(zip: ZipEntries): string {
  const workbook = zip.text('xl/workbook.xml')
  if (!workbook) throw new Error('broken')
  const rels = new Map<string, string>()
  for (const r of elements(parseXml(zip.text('xl/_rels/workbook.xml.rels') ?? '<Relationships/>'), 'Relationship'))
    rels.set(r.attrs.Id, joinPath('xl', r.attrs.Target ?? ''))
  const shared = zip.text('xl/sharedStrings.xml')
  const strings = shared
    ? elements(parseXml(shared), 'si').map(si =>
        // 富文本：几段 <r><t> 连起来；注音（rPh）不要
        elements(si)
          .filter(n => n.name === 't' || n.name === 'r')
          .map(textOf)
          .join(''),
      )
    : []
  const styles = zip.text('xl/styles.xml')
  const dates = dateStyles(styles ? parseXml(styles) : null)
  const sections: string[] = []
  for (const sheet of elements(child(parseXml(workbook), 'sheets'), 'sheet')) {
    const path = rels.get(sheet.attrs.id)
    const xml = path && zip.text(path)
    if (!xml) continue
    const rows = sheetRows(parseXml(xml), strings, dates)
    const name = sheet.attrs.name ?? ''
    if (!rows.length) {
      sections.push(`## ${tr('composer.extract.sheet', { p0: name })}\n${tr('composer.extract.emptySheet')}`)
      continue
    }
    const shown = rows.slice(0, SHEET_ROW_LIMIT)
    const note =
      rows.length > SHEET_ROW_LIMIT
        ? `\n${tr('composer.extract.sheetLimit', { p0: SHEET_ROW_LIMIT, p1: rows.length })}`
        : ''
    sections.push(
      `## ${tr('composer.extract.sheet', { p0: name })}（${tr('composer.extract.sheetSize', { p0: rows.length, p1: rows[0].length })}）\n` +
        shown.map(r => r.map(csvCell).join(',')).join('\n') +
        note,
    )
  }
  return sections.join('\n\n')
}
