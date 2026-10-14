import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { memo, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { CopyButton, cn } from '@/ui'
import { highlight, languageLabel, resolveLanguage } from './highlight'

/** 超过这么多行的代码块默认折叠（docs/ui/content-highlight.md §2 H） */
export const FOLD_OVER = 30
/** 折叠时显示的行数 */
export const FOLD_SHOW = 20

export const shouldFold = (lineCount: number): boolean => lineCount > FOLD_OVER

/**
 * 代码块（参考 Claude / Mirasim）：顶部一条标题栏，左边语言名、右边「复制」；下面是语法高亮的代码，
 * 横向滚动不折行。颜色只用设计变量（--syn-*），见 docs/ui/code-highlight.md。
 * 很长的代码块先只显示前 20 行，底部渐隐，可以展开 / 收起；复制照旧复制全部。
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
  const lines = useMemo(() => text.split('\n').length, [text])
  const foldable = shouldFold(lines)
  const [expanded, setExpanded] = useState(false)
  const folded = foldable && !expanded

  return (
    <div
      data-folded={folded || undefined}
      // 右键菜单（features/session/contextMenu）从这里认出代码块和语言
      data-code-block=""
      data-code-lang={lang ?? undefined}
      className={cn('group/code my-3 overflow-hidden rounded-lg border border-line bg-subtle', className)}
    >
      <div className="flex h-8 items-center justify-between border-b border-line-subtle pr-1.5 pl-3">
        <span className="truncate text-meta text-fg-muted">{label}</span>
        <CopyButton text={text} label={tr('code.CodeBlock.copyCode')} />
      </div>
      <div className="relative">
        <pre
          className={cn(
            'selectable overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-fg',
            // 20 行（lh 是一行的高度）加上下内边距
            folded && 'max-h-[calc(20lh+1.25rem)] overflow-y-hidden',
          )}
        >
          <code>{body}</code>
        </pre>
        {folded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-subtle to-transparent" />
        )}
      </div>
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          className="flex h-8 w-full items-center justify-center gap-1 border-t border-line-subtle text-meta text-fg-muted hover:bg-hover hover:text-fg"
        >
          {expanded ? <ChevronUp size={13} strokeWidth={1.75} /> : <ChevronDown size={13} strokeWidth={1.75} />}
          {expanded ? tr('content.code.collapse') : tr('content.code.expand', { n: lines })}
        </button>
      )}
    </div>
  )
})
