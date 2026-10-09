import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { memo, useMemo } from 'react'
import { CopyButton, cn } from '@/ui'
import { highlight, languageLabel, resolveLanguage } from './highlight'

/**
 * 代码块（参考 Claude / Mirasim）：顶部一条标题栏，左边语言名、右边「复制」；下面是语法高亮的代码，
 * 横向滚动不折行。颜色只用设计变量（--syn-*），见 docs/ui/code-highlight.md
 */
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  className,
}: {
  code: string
  /** 代码块标注的语言（```ts 里的 ts）；没有标注时为 null */
  lang: string | null
  className?: string
}) {
  useI18n()
  // Markdown 解析出来的代码末尾常带一个换行，去掉免得多出一行空白
  const text = code.endsWith('\n') ? code.slice(0, -1) : code
  const resolved = resolveLanguage(lang)
  const label = languageLabel(lang) ?? tr('code.CodeBlock.code')
  const body = useMemo(() => highlight(text, resolved), [text, resolved])

  return (
    <div className={cn('group/code my-3 overflow-hidden rounded-lg border border-line bg-subtle', className)}>
      <div className="flex h-8 items-center justify-between border-b border-line-subtle pr-1.5 pl-3">
        <span className="truncate text-meta text-fg-muted">{label}</span>
        <CopyButton text={text} label={tr('code.CodeBlock.copyCode')} />
      </div>
      <pre className="selectable overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-fg">
        <code>{body}</code>
      </pre>
    </div>
  )
})
