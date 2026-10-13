// 读 Office / OpenDocument 里的 XML（docs/ui/composer-file-attachments.md §7）：这些文件都是规整的 XML，
// 自己解析一遍成树，界面和测试里一样能用（测试环境没有 DOMParser）。只保留元素、属性和文字，名字去掉命名空间前缀
export interface XmlNode {
  /** 去掉前缀的名字：w:p → p */
  name: string
  /** 带前缀的属性名也去掉前缀：r:id → id */
  attrs: Record<string, string>
  children: XmlChild[]
}
export type XmlChild = XmlNode | string

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code] ?? whole
  })
}

const local = (name: string): string => name.slice(name.indexOf(':') + 1)

/** 解析成树，返回根元素；不是 XML 时报错 */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [] }
  const stack: XmlNode[] = [root]
  const tag =
    /<(\/?)([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g
  const attr = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let last = 0
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const top = stack[stack.length - 1]
    if (m.index > last) {
      const text = source.slice(last, m.index)
      if (text) top.children.push(decodeEntities(text))
    }
    last = tag.lastIndex
    if (m[5] !== undefined) {
      top.children.push(m[5])
      continue
    }
    if (!m[2]) continue
    const name = local(m[2])
    if (m[1]) {
      // 结束标签：一直弹到同名的（容错）
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].name === name) {
          stack.length = i
          break
        }
      continue
    }
    const attrs: Record<string, string> = {}
    for (let a = attr.exec(m[3]); a; a = attr.exec(m[3])) attrs[local(a[1])] = decodeEntities(a[3] ?? a[4] ?? '')
    attr.lastIndex = 0
    const node: XmlNode = { name, attrs, children: [] }
    top.children.push(node)
    if (!m[4]) stack.push(node)
  }
  const element = root.children.find((c): c is XmlNode => typeof c !== 'string')
  if (!element) throw new Error('not xml')
  return element
}

export const elements = (node: XmlNode | undefined, name?: string): XmlNode[] =>
  (node?.children ?? []).filter((c): c is XmlNode => typeof c !== 'string' && (!name || c.name === name))

export const first = (node: XmlNode | undefined, name: string): XmlNode | undefined => elements(node, name)[0]

/** 按路径往下找：path('body', 'p') */
export function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let at = node
  for (const name of path) at = first(at, name)
  return at
}

/** 所有后代里叫这个名字的（深度优先、按出现顺序） */
export function descendants(node: XmlNode | undefined, name: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode): void => {
    for (const c of n.children)
      if (typeof c !== 'string') {
        if (c.name === name) out.push(c)
        walk(c)
      }
  }
  if (node) walk(node)
  return out
}

/** 节点里所有文字连起来 */
export function textOf(node: XmlNode | undefined): string {
  if (!node) return ''
  let out = ''
  for (const c of node.children) out += typeof c === 'string' ? c : textOf(c)
  return out
}
