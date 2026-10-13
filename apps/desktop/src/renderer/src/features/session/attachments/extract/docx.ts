// Word（.docx）→ 文字（docs/ui/composer-file-attachments.md §7）：段落、标题（# 标题）、列表、表格（Markdown 表格）、
// 脚注；批注列在最后。图片、页眉页脚、排版不带
import { tr } from '@/i18n/core'
import { child, elements, first, parseXml, type XmlNode } from './xml'
import { widest } from './xlsx'
import type { ZipEntries } from './zip'

export const DOCX_PARTS = [
  'word/document.xml',
  'word/styles.xml',
  'word/footnotes.xml',
  'word/comments.xml',
  'word/numbering.xml',
]

/** 样式 id → 标题级别（Heading 1 / 标题 1 / Title） */
function headingStyles(styles: XmlNode | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const style of elements(styles ?? undefined, 'style')) {
    const id = style.attrs.styleId
    const name = first(style, 'name')?.attrs.val ?? ''
    const level = /^title$/i.test(name) ? 1 : Number(/^(?:heading|标题)\s*(\d)$/i.exec(name)?.[1] ?? 0)
    if (id && level) out.set(id, level)
  }
  return out
}

/**
 * 样式里带的编号（Word 自带的「列表编号」「列表项目符号」这类样式，段落自己不写 numPr）：
 * 样式 id → numPr；样式里没写 numPr 时按名字认（List Number / List Bullet）
 */
type StyleList = { numId?: string; ilvl: number; ordered?: boolean }
function styleLists(styles: XmlNode | null): Map<string, StyleList> {
  const out = new Map<string, StyleList>()
  for (const style of elements(styles ?? undefined, 'style')) {
    const id = style.attrs.styleId
    if (!id) continue
    const num = child(style, 'pPr', 'numPr')
    const name = first(style, 'name')?.attrs.val ?? ''
    const level = Number(/(\d)$/.exec(name)?.[1] ?? 1) - 1
    if (num) out.set(id, { numId: first(num, 'numId')?.attrs.val, ilvl: Number(first(num, 'ilvl')?.attrs.val ?? 0) })
    else if (/^list number/i.test(name)) out.set(id, { ilvl: level, ordered: true })
    else if (/^list bullet/i.test(name)) out.set(id, { ilvl: level, ordered: false })
  }
  return out
}

/** 编号列表：numId + 级别 → 是不是有序（numFmt 不是 bullet） */
function orderedLists(numbering: XmlNode | null): (numId: string, level: number) => boolean {
  const abstract = new Map<string, XmlNode>()
  for (const a of elements(numbering ?? undefined, 'abstractNum')) abstract.set(a.attrs.abstractNumId, a)
  const nums = new Map<string, string>()
  for (const n of elements(numbering ?? undefined, 'num'))
    nums.set(n.attrs.numId, first(n, 'abstractNumId')?.attrs.val ?? '')
  return (numId, level) => {
    const lvl = elements(abstract.get(nums.get(numId) ?? ''), 'lvl').find(l => Number(l.attrs.ilvl) === level)
    const fmt = first(lvl, 'numFmt')?.attrs.val
    return !!fmt && fmt !== 'bullet' && fmt !== 'none'
  }
}

/** 一段里的字：w:t、制表、换行；脚注引用写成 [^n]；删除的修订（w:del）不要 */
function runText(node: XmlNode): string {
  let out = ''
  for (const c of node.children) {
    if (typeof c === 'string') continue
    if (c.name === 't' || c.name === 'delText') {
      if (c.name === 't') out += c.children.filter(x => typeof x === 'string').join('')
    } else if (c.name === 'tab') out += '\t'
    else if (c.name === 'br' || c.name === 'cr') out += '\n'
    else if (c.name === 'noBreakHyphen') out += '-'
    else if (c.name === 'footnoteReference') out += `[^${c.attrs.id}]`
    else if (c.name === 'del' || c.name === 'instrText' || c.name === 'pPr' || c.name === 'rPr') continue
    else out += runText(c)
  }
  return out
}

const cell = (text: string): string =>
  text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()

/** 表格 → Markdown 表格，第一行当表头；合并单元格按出现的格子排 */
export function markdownTable(rows: string[][]): string {
  const width = widest(rows)
  if (!rows.length || !width) return ''
  const line = (r: string[]): string => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

function table(tbl: XmlNode, paragraph: (p: XmlNode) => string): string {
  const rows = elements(tbl, 'tr').map(tr =>
    elements(tr, 'tc').map(tc => elements(tc, 'p').map(paragraph).filter(Boolean).join(' ')),
  )
  return markdownTable(rows)
}

export function docxText(zip: ZipEntries): string {
  const document = zip.text('word/document.xml')
  if (!document) throw new Error('broken')
  const parse = (path: string): XmlNode | null => {
    const text = zip.text(path)
    return text ? parseXml(text) : null
  }
  const headings = headingStyles(parse('word/styles.xml'))
  const ordered = orderedLists(parse('word/numbering.xml'))
  const listStyles = styleLists(parse('word/styles.xml'))
  const counters = new Map<string, number>()

  const plain = (p: XmlNode): string => runText(p).trim()
  const paragraph = (p: XmlNode): string => {
    const text = runText(p).replace(/[ \t]+$/gm, '')
    if (!text.trim()) return ''
    const props = first(p, 'pPr')
    const style = first(props, 'pStyle')?.attrs.val ?? ''
    const level = headings.get(style) ?? Number(/^(?:Heading|标题)\s*(\d)$/i.exec(style)?.[1] ?? 0)
    if (level) return `${'#'.repeat(Math.min(level, 6))} ${text.trim()}`
    const num = first(props, 'numPr')
    const fromStyle = listStyles.get(style)
    if (num || fromStyle) {
      const numId = first(num, 'numId')?.attrs.val ?? fromStyle?.numId ?? `style:${style}`
      const ilvl = Number(first(num, 'ilvl')?.attrs.val ?? fromStyle?.ilvl ?? 0)
      const indent = '  '.repeat(Math.min(ilvl, 6))
      if (numId !== '0') {
        if (fromStyle?.ordered ?? ordered(numId, ilvl)) {
          const key = `${numId}:${ilvl}`
          const n = (counters.get(key) ?? 0) + 1
          counters.set(key, n)
          return `${indent}${n}. ${text.trim()}`
        }
        return `${indent}- ${text.trim()}`
      }
    }
    return text
  }

  const blocks: string[] = []
  const walk = (node: XmlNode): void => {
    for (const c of elements(node)) {
      if (c.name === 'p') {
        const text = paragraph(c)
        if (text) blocks.push(text)
      } else if (c.name === 'tbl') {
        const md = table(c, plain)
        if (md) blocks.push(md)
      } else if (c.name === 'sdt' || c.name === 'sdtContent' || c.name === 'customXml' || c.name === 'ins') walk(c)
    }
  }
  walk(child(parseXml(document), 'body') ?? parseXml(document))

  const notes = elements(parse('word/footnotes.xml') ?? undefined, 'footnote')
    .filter(n => !n.attrs.type || n.attrs.type === 'normal')
    .map(n => {
      const text = elements(n, 'p').map(plain).filter(Boolean).join(' ')
      return text ? `[^${n.attrs.id}]: ${text}` : ''
    })
    .filter(Boolean)
  if (notes.length) blocks.push(notes.join('\n'))

  const comments = elements(parse('word/comments.xml') ?? undefined, 'comment')
    .map(c => {
      const text = elements(c, 'p').map(plain).filter(Boolean).join(' ')
      const who = c.attrs.author ? `${c.attrs.author}：` : ''
      return text ? `- ${who}${text}` : ''
    })
    .filter(Boolean)
  if (comments.length) blocks.push(`## ${tr('composer.extract.comments')}\n${comments.join('\n')}`)
  return blocks.join('\n\n')
}
