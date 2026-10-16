import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { nativeSessionAction } from '@/features/engine/store'

/** 提示右边的按钮：「加载更早的」/「补上终端里新聊的 N 轮」（docs/ui/claude-resume.md §4.8）；点了由宿主换掉整个条目列表 */
export function NativeNoticeAction({
  action,
  sessionId,
  onError,
}: {
  action: { kind: 'native-earlier' | 'native-sync'; count: number }
  sessionId: string
  onError?: (message: string | null) => void
}) {
  useI18n()
  const [acting, setActing] = useState(false)
  return (
    <button
      type="button"
      data-native-action={action.kind}
      disabled={acting}
      onClick={() => {
        setActing(true)
        onError?.(null)
        nativeSessionAction(sessionId, action.kind === 'native-earlier' ? 'earlier' : 'sync')
          .catch((e: unknown) => onError?.((e as Error).message))
          .finally(() => setActing(false))
      }}
      className="press -my-0.5 inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-meta text-accent-fg hover:bg-hover disabled:opacity-50"
    >
      {action.kind === 'native-earlier' ? tr('resume.earlier') : tr('resume.sync', { count: action.count })}
    </button>
  )
}
