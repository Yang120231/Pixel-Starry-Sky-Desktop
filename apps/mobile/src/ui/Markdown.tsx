// 回复正文：和桌面端用同一套库（react-markdown + remark-gfm）；代码块带复制和高亮（ui/code.tsx），还没有公式
// （packages/ui 抽出后换成共用的）。
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './code'

/** react-markdown 给的语法树节点（hast），只用到这几个字段 */
interface Node {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: Node[]
}

const textOf = (n: Node): string => (n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join(''))

const components: Components = {
  pre({ node, children }) {
    const code = (node as unknown as Node | undefined)?.children?.find(c => c.type === 'element')
    if (code?.tagName !== 'code') return <pre>{children}</pre>
    const classes = Array.isArray(code.properties?.className) ? code.properties.className.map(String) : []
    const lang = classes.find(c => c.startsWith('language-'))?.slice('language-'.length) || null
    return <CodeBlock code={textOf(code).replace(/\n$/, '')} lang={lang} />
  },
}

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown text-prose text-fg-body">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
