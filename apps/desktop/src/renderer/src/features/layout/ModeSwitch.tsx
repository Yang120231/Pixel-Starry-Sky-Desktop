import { CodeXml, MessagesSquare } from 'lucide-react'
import { SEGMENT_TRACK, cn, segmentItem } from '@/ui'
import { setAppMode, useAppMode } from '@/features/coding/mode'
import { tr } from '@/i18n/core'

/** 「对话 | 代码」切换（docs/ui/layout-v2.md §5）：侧栏顶部和代码模式顶栏各放一个 */
export function ModeSwitch({ variant }: { variant: 'sidebar' | 'topbar' }) {
  const mode = useAppMode()
  // 轨道左边和下面的行同在 x=12；边框 1 + 内边距 3 + 左内边距 6，图标落在 x=22、字落在 x=48，和下面「新建任务」等行的图标、文字对齐
  const item = 'gap-2.5 pr-2.5 pl-1.5 text-list'
  return (
    <div
      role="group"
      aria-label={tr('sidebar.mode.group')}
      data-mode-switch={variant}
      className={cn(SEGMENT_TRACK, variant === 'topbar' && 'no-drag')}
    >
      <button
        type="button"
        aria-pressed={mode === 'chat'}
        onClick={() => setAppMode('chat')}
        className={cn(segmentItem(mode === 'chat'), item)}
      >
        <MessagesSquare size={16} strokeWidth={1.5} className="shrink-0" />
        {tr('sidebar.mode.chat')}
      </button>
      <button
        type="button"
        aria-pressed={mode === 'code'}
        onClick={() => setAppMode('code')}
        className={cn(segmentItem(mode === 'code'), item)}
      >
        <CodeXml size={16} strokeWidth={1.5} className="shrink-0" />
        {tr('sidebar.mode.code')}
      </button>
    </div>
  )
}
