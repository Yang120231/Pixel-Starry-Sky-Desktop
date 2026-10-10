import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useMemo } from 'react'
import { cn } from '@/ui'
import { highlightLines, languageFromPath } from './highlight'

/**
 * 带颜色的 diff（只用设计变量：增加行绿底、删除行红底）。给了 path 且认得文件类型时做语法高亮：
 * 行首 +/− 保持绿 / 红，代码本身用 --syn-* 着色（参考 Mirasim）。见 docs/ui/code-highlight.md
 */
export function DiffView({ diff, path, className }: { diff: string; path?: string; className?: string }) {
  useI18n()
  const lines = useMemo(() => diff.split('\n'), [diff])
  // 去掉每行开头的 +/−/空格 后整段高亮（跨行的注释、字符串颜色才对）；@@ 段头和 ---/+++ 文件头不参与
  const code = useMemo(() => {
    const lang = languageFromPath(path)
    if (!lang) return null
    return highlightLines(lines.map(l => (isCodeLine(l) ? l.slice(1) : '')).join('\n'), lang)
  }, [lines, path])
  if (!diff)
    return (
      <div className={cn('px-3 py-2 text-meta text-fg-faint', className)}>
        {tr('session.live.ItemRows.noChangesToDisplay')}
      </div>
    )
  return (
    <pre className={cn('overflow-auto font-mono text-meta leading-[1.6]', className)}>
      {lines.map((line, i) => {
        const highlighted = code !== null && isCodeLine(line)
        return (
          <div
            key={i}
            className={cn(
              'px-3 whitespace-pre',
              line.startsWith('+') && cn('bg-success/10', highlighted ? 'text-fg' : 'text-success'),
              line.startsWith('-') && cn('bg-danger/10', highlighted ? 'text-fg' : 'text-danger'),
              line.startsWith('@@') && 'text-fg-faint',
              line.startsWith(' ') && 'text-fg-secondary',
            )}
          >
            {highlighted ? (
              <>
                <span className={line[0] === '+' ? 'text-success' : line[0] === '-' ? 'text-danger' : undefined}>
                  {line[0]}
                </span>
                {code[i]}
              </>
            ) : (
              line || ' '
            )}
          </div>
        )
      })}
    </pre>
  )
}

/** 带 +/−/空格 前缀的代码行（不是 @@ 段头，也不是 ---/+++ 文件头） */
function isCodeLine(line: string): boolean {
  if (line.startsWith('+++') || line.startsWith('---')) return false
  return line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')
}
