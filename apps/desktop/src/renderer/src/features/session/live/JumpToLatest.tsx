import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 回到最新（docs/ui/conversation-ux.md §2.4）：往上翻离开底部时浮在对话区底部居中；离开后又来了新内容，变成「↓ 新内容」
import { ArrowDown } from 'lucide-react'
import { cn } from '@/ui'

export function JumpToLatest({ unseen, onClick }: { unseen: boolean; onClick: () => void }) {
  useI18n()
  return (
    // 外层负责居中（transform），按钮自己做 pop-in 动画，两者的 transform 不冲突
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={tr('session.live.LiveTranscript.jumpToLatest')}
        title={tr('session.live.LiveTranscript.jumpToLatest')}
        className={cn(
          'press pop-in pointer-events-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-line bg-surface text-fg-secondary shadow-popover hover:text-fg',
          unseen ? 'px-3 text-meta' : 'w-8',
        )}
      >
        {unseen && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
        <ArrowDown size={14} strokeWidth={1.75} className="shrink-0" />
        {unseen && <span>{tr('session.live.LiveTranscript.newContent')}</span>}
      </button>
    </div>
  )
}
