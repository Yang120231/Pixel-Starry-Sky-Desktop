import { useI18n } from '@/i18n/I18nProvider'
import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '@/components/ui'
import { CodeBlock } from '@/components/code/CodeBlock'
import type { Element, ElementContent } from 'hast'

/** 取出 hast 节点里的全部文字（代码块的原文） */
function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

/** ```lang 围起来的代码块 → <pre><code class="language-lang">；取出语言和原文交给 CodeBlock 高亮 */
function fencedCode(pre: Element | undefined): { code: string; lang: string | null } {
  const code = pre?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code')
  const classes = code?.properties?.className
  const langClass = Array.isArray(classes) ? classes.map(String).find(c => c.startsWith('language-')) : undefined
  return { code: code ? textOf(code) : '', lang: langClass ? langClass.slice('language-'.length) : null }
}

/** 链接一律在新窗口打开（主进程会交给系统浏览器，只放行 http / https） */
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="my-3 max-w-full overflow-x-auto">
      <table {...props} />
    </div>
  ),
  // 代码块：语言标题栏 + 复制按钮 + 语法高亮（docs/ui/code-highlight.md）
  pre: ({ node }) => {
    const { code, lang } = fencedCode(node)
    return <CodeBlock code={code} lang={lang} />
  },
}

/** 正文 Markdown：14px / 1.7；行内代码偏暖色（参考 Mirasim / Claude）；代码块见 CodeBlock；表格细边框。只用设计变量 */
const PROSE = [
  'text-prose text-fg-body break-words',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:my-2.5',
  '[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_li]:my-1 [&_li]:pl-1 [&_li]:marker:text-fg-faint',
  '[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-section [&_h1]:font-semibold [&_h1]:text-fg',
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-section [&_h2]:font-semibold [&_h2]:text-fg',
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h3]:text-fg',
  '[&_strong]:font-semibold [&_strong]:text-fg',
  '[&_a]:text-accent-fg [&_a]:underline [&_a]:underline-offset-2',
  '[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-code-inline-bg [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:text-code-inline',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-list',
  '[&_th]:border [&_th]:border-line [&_th]:bg-subtle [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-line [&_td]:px-2.5 [&_td]:py-1.5',
  '[&_hr]:my-4 [&_hr]:border-line',
].join(' ')

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  useI18n()
  return (
    <div className={cn(PROSE, className)}>
      {/* remark-breaks：单个换行也换行（聊天回复里一行一个的列表、数字不会挤成一段） */}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
