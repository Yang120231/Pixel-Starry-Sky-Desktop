// 点选元素批注的纯函数（docs/ui/element-annotation.md §3）：发给会话的文字、截图变图片附件
import type { ImageAttachment } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import type { BrowserAnnotation, ElementNoteField } from '../../../../shared/types/project-browser'

/** 以 / 开头的是斜杠命令：原样发，不往前后拼内容 */
export const isSlashCommand = (text: string): boolean => text.trimStart().startsWith('/')

const on = (a: BrowserAnnotation, field: ElementNoteField): boolean => !a.off?.includes(field)

/** 列表和附件卡里的标题：标签名.类名 · 元素文字 */
export function noteTitle(a: BrowserAnnotation): string {
  const parts = [a.label, a.element].filter(Boolean)
  return parts.length ? parts.join(' · ') : a.text
}

/** 批注页的路由：第一条带路由的批注的；整页批注没有 */
export const notesRoute = (notes: readonly BrowserAnnotation[]): string => notes.find(a => a.route)?.route ?? ''

/** 网址的主机部分（附件卡的副标题）；解析不了原样返回 */
export function urlHost(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function headerUrl(first: BrowserAnnotation): string {
  if (first.selector && !on(first, 'route'))
    try {
      return new URL(first.url).origin
    } catch {
      return first.url
    }
  return first.url
}

/** 发给会话的文字块（格式见规格 §3）；勾选取消的项不写 */
export function notesText(notes: readonly BrowserAnnotation[]): string {
  if (!notes.length) return ''
  const route = notesRoute(notes)
  const lines = [
    tr('projectTools.elementNote.head', { p0: notes.length }),
    tr('projectTools.elementNote.url', { p0: headerUrl(notes[0]) }),
  ]
  notes.forEach((a, i) => {
    const n = i + 1
    if (!a.selector) {
      lines.push(tr('projectTools.elementNote.page', { p0: n, p1: a.text }))
      return
    }
    lines.push(
      a.element && on(a, 'element')
        ? tr('projectTools.elementNote.title', { p0: n, p1: a.label ?? '', p2: a.element })
        : tr('projectTools.elementNote.titleBare', { p0: n, p1: a.label ?? a.selector }),
    )
    if (a.route && on(a, 'route') && i > 0 && a.route !== route)
      lines.push(tr('projectTools.elementNote.route', { p0: a.route }))
    if (on(a, 'selector')) lines.push(tr('projectTools.elementNote.selector', { p0: a.selector }))
    lines.push(tr('projectTools.elementNote.opinion', { p0: a.text }))
  })
  return lines.join('\n')
}

/** 批注的截图 → 输入框的图片附件；没有截图或数据不对返回 null */
export function shotImage(a: BrowserAnnotation, n: number): ImageAttachment | null {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+)(={0,2})$/.exec(a.shot ?? '')
  if (!m || !a.shotSize) return null
  const base64 = m[1] + m[2]
  if (base64.length % 4) return null
  return {
    // 用批注的 id：「放回列表」时按它把卡片上的截图一起拿掉
    id: a.id,
    name: `annotation-${n}.jpg`,
    mediaType: 'image/jpeg',
    bytes: (base64.length / 4) * 3 - m[2].length,
    width: a.shotSize.width,
    height: a.shotSize.height,
    dataBase64: base64,
  }
}
