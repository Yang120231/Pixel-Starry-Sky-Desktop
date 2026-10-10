import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useMemo } from 'react'
import { cn } from '@/ui'
import { highlightSegments, languageFromPath } from './highlight'
import { cutSegments, wordDiffRanges } from './wordDiff'

/**
 * 带颜色的 diff（只用设计变量：增加行绿底、删除行红底）。给了 path 且认得文件类型时做语法高亮：
 * 行首 +/− 保持绿 / 红，代码本身用 --syn-* 着色（参考 Mirasim）。见 docs/ui/code-highlight.md
 * 成对的删除 / 增加行里真正变化的词再加深一层底色（docs/ui/content-highlight.md §2 C）。
 */
export function DiffView({ diff, path, className }: { diff: string; path?: string; className?: string }) {
  useI18n()
  const lines = useMemo(() => diff.split('\n'), [diff])
  const lang = useMemo(() => languageFromPath(path), [path])
  // 去掉每行开头的 +/−/空格 后整段高亮（跨行的注释、字符串颜色才对）；@@ 段头和 ---/+++ 文件头不参与
  const segments = useMemo(
    () => highlightSegments(lines.map(l => (isCodeLine(l) ? l.slice(1) : '')).join('\n'), lang),
    [lines, lang],
  )
  const words = useMemo(() => wordDiffRanges(lines), [lines])
  if (!diff)
    return (
      <div className={cn('px-3 py-2 text-meta text-fg-faint', className)}>
        {tr('session.live.ItemRows.noChangesToDisplay')}
      </div>
    )
  return (
    <pre className={cn('overflow-auto font-mono text-meta leading-[1.6]', className)}>
      {lines.map((line, i) => {
        const code = isCodeLine(line)
        const added = line.startsWith('+'),
          removed = line.startsWith('-')
        return (
          <div
            key={i}
            className={cn(
              'px-3 whitespace-pre',
              added && cn('bg-success/10', lang && code ? 'text-fg' : 'text-success'),
              removed && cn('bg-danger/10', lang && code ? 'text-fg' : 'text-danger'),
              line.startsWith('@@') && 'text-fg-faint',
              line.startsWith(' ') && 'text-fg-secondary',
            )}
          >
            {code ? (
              <>
                <span className={added ? 'text-success' : removed ? 'text-danger' : undefined}>{line[0]}</span>
                {cutSegments(segments[i] ?? [], words.get(i) ?? []).map((s, j) => (
                  <span
                    key={j}
                    className={cn(
                      s.className,
                      s.changed && 'rounded-[2px]',
                      s.changed && (added ? 'bg-success/25' : 'bg-danger/25'),
                    )}
                  >
                    {s.text}
                  </span>
                ))}
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
