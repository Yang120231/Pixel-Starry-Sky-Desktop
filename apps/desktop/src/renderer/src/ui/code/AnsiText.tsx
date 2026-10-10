import { memo, useMemo } from 'react'
import { cn } from '@/ui'
import { hasAnsi, parseAnsi } from './ansi'

/**
 * 带 ANSI 颜色的命令输出（docs/ui/content-highlight.md §2 D）。颜色类 ansi-fg-N / ansi-bg-N 在 globals.css，
 * 用终端调色板的设计变量；没有控制序列的输出原样显示。外层的 pre 由调用方给。
 */
export const AnsiText = memo(function AnsiText({ text }: { text: string }) {
  const spans = useMemo(() => (hasAnsi(text) ? parseAnsi(text) : null), [text])
  if (!spans) return <>{text}</>
  return (
    <>
      {spans.map((s, i) =>
        s.fg === null && s.bg === null && !s.bold && !s.dim && !s.italic && !s.underline ? (
          s.text
        ) : (
          <span
            key={i}
            className={cn(
              s.fg !== null && `ansi-fg-${s.fg}`,
              s.bg !== null && `ansi-bg-${s.bg}`,
              s.bold && 'font-semibold',
              s.dim && 'opacity-70',
              s.italic && 'italic',
              s.underline && 'underline',
            )}
          >
            {s.text}
          </span>
        ),
      )}
    </>
  )
})
