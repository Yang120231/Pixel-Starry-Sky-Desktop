// PowerPoint（.pptx）→ 文字（docs/ui/composer-file-attachments.md §7）：按放映顺序每页一节「第 N 页：标题」，
// 下面是正文（项目符号、表格），最后是演讲者备注。图片、动画、版式不带
import { tr } from '@/i18n/core'
import { markdownTable } from './docx'
import { child, descendants, elements, first, parseXml, type XmlNode } from './xml'
import { joinPath, type ZipEntries } from './zip'

export const PPTX_PARTS = (name: string): boolean =>
  name === 'ppt/presentation.xml' ||
  name === 'ppt/_rels/presentation.xml.rels' ||
  /^ppt\/slides\/[^/]+\.xml$/.test(name) ||
  /^ppt\/slides\/_rels\/[^/]+\.rels$/.test(name) ||
  /^ppt\/notesSlides\/[^/]+\.xml$/.test(name)

/** 一段：a:t 连起来，a:br 换行；项目符号按缩进级别 */
function paragraphText(p: XmlNode): string {
  let out = ''
  for (const c of elements(p)) {
    if (c.name === 'r' || c.name === 'fld')
      out += descendants(c, 't')
        .map(t => t.children.join(''))
        .join('')
    else if (c.name === 'br') out += '\n'
  }
  return out
}

function bodyLines(txBody: XmlNode | undefined, bullets: boolean): string[] {
  return elements(txBody, 'p')
    .map(p => {
      const text = paragraphText(p).trim()
      if (!text) return ''
      const level = Number(first(p, 'pPr')?.attrs.lvl ?? 0)
      return bullets ? `${'  '.repeat(Math.min(level, 6))}- ${text}` : text
    })
    .filter(Boolean)
}

const placeholder = (shape: XmlNode): string | undefined => descendants(child(shape, 'nvSpPr'), 'ph')[0]?.attrs.type

/** 一页的形状按出现顺序：标题单独拿出来，文本框、表格、组合里的都算正文 */
function slideContent(slide: XmlNode): { title: string; body: string[] } {
  let title = ''
  const body: string[] = []
  const walk = (tree: XmlNode | undefined): void => {
    for (const shape of elements(tree)) {
      if (shape.name === 'sp') {
        const type = placeholder(shape)
        const tx = first(shape, 'txBody')
        if ((type === 'title' || type === 'ctrTitle') && !title) title = bodyLines(tx, false).join(' ')
        else body.push(...bodyLines(tx, type === 'body' || type === undefined || type === 'obj'))
      } else if (shape.name === 'graphicFrame') {
        for (const tbl of descendants(shape, 'tbl')) {
          const rows = elements(tbl, 'tr').map(tr =>
            elements(tr, 'tc').map(tc => bodyLines(first(tc, 'txBody'), false).join(' ')),
          )
          const md = markdownTable(rows)
          if (md) body.push(md)
        }
      } else if (shape.name === 'grpSp') walk(shape)
    }
  }
  walk(child(slide, 'cSld', 'spTree'))
  return { title, body }
}

function notesText(notes: XmlNode): string {
  return elements(child(notes, 'cSld', 'spTree'), 'sp')
    .filter(sp => placeholder(sp) === 'body')
    .flatMap(sp => bodyLines(first(sp, 'txBody'), false))
    .join('\n')
}

export function pptxText(zip: ZipEntries): string {
  const presentation = zip.text('ppt/presentation.xml')
  if (!presentation) throw new Error('broken')
  const rels = new Map<string, string>()
  for (const r of elements(parseXml(zip.text('ppt/_rels/presentation.xml.rels') ?? '<Relationships/>'), 'Relationship'))
    rels.set(r.attrs.Id, joinPath('ppt', r.attrs.Target ?? ''))
  const ids = elements(child(parseXml(presentation), 'sldIdLst'), 'sldId')
  const sections: string[] = []
  ids.forEach((id, i) => {
    const path = rels.get(id.attrs.id)
    const xml = path && zip.text(path)
    if (!path || !xml) return
    const { title, body } = slideContent(parseXml(xml))
    // 备注：这一页的 rels 里指向 notesSlide 的那个
    const dir = path.slice(0, path.lastIndexOf('/'))
    const slideRels = zip.text(`${dir}/_rels/${path.slice(dir.length + 1)}.rels`)
    const notePath = slideRels
      ? elements(parseXml(slideRels), 'Relationship').find(r => /notesSlide$/.test(r.attrs.Type ?? ''))?.attrs.Target
      : undefined
    const notesXml = notePath && zip.text(joinPath(dir, notePath))
    const notes = notesXml ? notesText(parseXml(notesXml)) : ''
    const heading = `## ${tr('composer.extract.slide', { p0: i + 1 })}${title ? `：${title}` : ''}`
    const lines = [heading, ...body]
    if (notes) lines.push(`> ${tr('composer.extract.notes')}：${notes.replace(/\n/g, '\n> ')}`)
    sections.push(lines.join('\n'))
  })
  return sections.join('\n\n')
}
