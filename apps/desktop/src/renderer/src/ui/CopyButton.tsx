import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from './cn'

/**
 * 复制按钮：代码块（图标 + 文字）和消息操作行（仅图标）共用。
 * 成功 / 失败的状态显示 1.5 秒后复原。
 */
export function CopyButton({ text, label, iconOnly }: { text: string; label?: string; iconOnly?: boolean }) {
  useI18n()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 1500)
    return () => clearTimeout(t)
  }, [state])

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    )
  }

  const Icon = state === 'copied' ? Check : Copy
  const status =
    state === 'copied'
      ? tr('code.CodeBlock.message55')
      : state === 'failed'
        ? tr('code.CodeBlock.message56')
        : tr('code.CodeBlock.message57')
  const name = label ?? tr('code.CodeBlock.message57')
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={name}
      title={iconOnly ? (state === 'idle' ? name : status) : undefined}
      className={cn(
        'press no-drag inline-flex h-6 items-center gap-1 rounded-md text-meta hover:bg-hover',
        iconOnly ? 'w-6 justify-center' : 'px-1.5',
        state === 'copied' ? 'text-success' : state === 'failed' ? 'text-danger' : 'text-fg-muted hover:text-fg',
      )}
    >
      <Icon size={13} strokeWidth={1.5} />
      {iconOnly ? (
        <span className="sr-only" aria-live="polite">
          {state === 'idle' ? '' : status}
        </span>
      ) : (
        <span aria-live="polite">{status}</span>
      )}
    </button>
  )
}
