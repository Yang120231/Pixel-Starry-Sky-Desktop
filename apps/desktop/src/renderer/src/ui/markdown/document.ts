// 文档模式（docs/ui/markdown-preview.md）：给块级元素标源码行号、给标题加 id。纯函数，不依赖 React。
import type { Element, ElementContent, Root } from 'hast'

/** 带 data-line 的块级元素 */
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'table', 'pre', 'blockquote', 'hr', 'ul', 'ol'])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function walk(node: Root | Element, visit: (el: Element) => void): void {
  for (const child of node.children as ElementContent[]) {
    if (child.type !== 'element') continue
    visit(child)
    walk(child, visit)
  }
}

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

/** 每个块级元素加 data-line = 源码起始行（从 1 起） */
export function rehypeSourceLines() {
  return (tree: Root): void => {
    walk(tree, el => {
      const line = el.position?.start.line
      if (line && BLOCKS.has(el.tagName)) el.properties = { ...el.properties, dataLine: line }
    })
  }
}

/** GitHub 式 slug：小写、去标点（留 - 和 _）、空格换 -；中文等字母原样保留 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** 标题加 id；重复的依次加 -1、-2 */
export function rehypeHeadingIds() {
  return (tree: Root): void => {
    const used = new Map<string, number>()
    walk(tree, el => {
      if (!HEADINGS.has(el.tagName)) return
      const base = slugify(textOf(el))
      const seen = used.get(base)
      used.set(base, (seen ?? 0) + 1)
      el.properties = { ...el.properties, id: seen === undefined ? base : `${base}-${seen}` }
    })
  }
}
