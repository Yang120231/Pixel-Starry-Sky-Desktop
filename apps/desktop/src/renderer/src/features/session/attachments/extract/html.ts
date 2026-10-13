// 网页 → 正文（docs/ui/composer-file-attachments.md §7.3）：保存下来的大网页、EPUB 的章节。网页不一定是规整的 XML，
// 按标签粗略地转：脚本、样式、head 不要；标题写成 #，列表写成 -，表格写成 Markdown 表格，链接只留字，图片留 alt
import { markdownTable } from './docx'
import { decodeEntities } from './xml'

const NAMED: Record<string, string> = {
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  times: '×',
  divide: '÷',
  deg: '°',
  yen: '¥',
  euro: '€',
  pound: '£',
}

function entities(text: string): string {
  return decodeEntities(text.replace(/&([a-z]+);/gi, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole))
}

/** 表格 → Markdown 表格（和 Word 里的一样）；格子里的标签去掉，实体留给后面统一解 */
function table(html: string): string {
  const rows = [...html.matchAll(/<tr\b[\s\S]*?(?=<tr\b|<\/table|$)/gi)].map(([row]) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr|$)/gi)].map(([, cell]) =>
      cell
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  )
  return markdownTable(rows.filter(r => r.length))
}

const BLOCKS = 'p|div|section|article|header|footer|blockquote|pre|ul|ol|dl|dt|dd|figure|figcaption|hr|main|nav|aside'

export function htmlToText(html: string): string {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<table\b[\s\S]*?<\/table\s*>/gi, t => `\n\n${table(t)}\n\n`)
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(new RegExp(`<\\/?(${BLOCKS})\\b[^>]*>`, 'gi'), '\n\n')
    .replace(/<img\b[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_, a?: string, b?: string) =>
      a || b ? `[${a || b}]` : '',
    )
    .replace(/<[^>]+>/g, '')
  return entities(s)
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 标题：<title> 里的字 */
export function htmlTitle(html: string): string {
  return entities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()
}
