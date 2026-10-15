// 团队回复了反馈时窗口在前台的应用内提示（docs/ui/feedback-v2.md §4）：右下角卡片，团队图标 + 标题 + 预览 + 「查看 / 稍后」。
// 窗口不在前台时仍是系统通知（FeedbackNotifier 决定走哪条）。ui/Toast 是顶部居中的一行提示、带单个按钮，放不下这张卡，所以单独做。
import { useEffect, useSyncExternalStore } from 'react'
import { Users, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Button } from '@/ui'

export interface FeedbackToastData {
  threadId: string
  count: number
  title: string
  preview: string
}

const SHOW_MS = 15_000
let current: FeedbackToastData | null = null
const listeners = new Set<() => void>()

function set(next: FeedbackToastData | null): void {
  current = next
  listeners.forEach(fn => fn())
}

export const showFeedbackToast = (data: FeedbackToastData): void => set(data)
export const dismissFeedbackToast = (): void => set(null)

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** onView：点「查看」，打开设置 › 反馈 › 那一条（多条时打开第一条） */
export function FeedbackToast({ onView }: { onView: (threadId: string) => void }) {
  useI18n()
  const data = useSyncExternalStore(subscribe, () => current)
  // 新的一条出现就重新计时；鼠标停在上面时不消失
  useEffect(() => {
    if (!data) return
    const timer = window.setTimeout(dismissFeedbackToast, SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [data])
  if (!data) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-feedback-toast
      className="fade-in fixed right-4 bottom-4 z-[90] flex w-[340px] max-w-[calc(100%-32px)] items-start gap-3 rounded-xl border border-line-card bg-popover p-3.5 text-fg shadow-menu"
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-on"
      >
        <Users size={16} strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium">
          {data.count > 1 ? tr('feedback.notify.titleMany', { p0: data.count }) : tr('feedback.notify.title')}
        </p>
        <p className="mt-0.5 truncate text-meta font-medium text-fg-secondary">{data.title}</p>
        {data.preview && <p className="line-clamp-2 text-meta text-fg-muted">{data.preview}</p>}
        <div className="mt-2.5 flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              dismissFeedbackToast()
              onView(data.threadId)
            }}
          >
            {tr('feedback.attach.view')}
          </Button>
          <Button variant="ghost" onClick={dismissFeedbackToast}>
            {tr('feedback.toast.later')}
          </Button>
        </div>
      </div>
      <button
        type="button"
        aria-label={tr('feedback.toast.later')}
        onClick={dismissFeedbackToast}
        className="press -mt-1 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  )
}
