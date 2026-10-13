import { CodeXml, MessagesSquare, PanelLeft } from 'lucide-react'
import { IconButton, SEGMENT_TRACK, cn, segmentItem, useToast } from '@/ui'
import { TOGGLE_SIDEBAR, withShortcut } from '@/features/layout/shortcuts'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'

const isMac = window.pixelsky?.platform === 'darwin'

/** 顶部 48px：左边「对话 | 代码」切换（docs/ui/layout-v2.md §5），右边收起按钮。 */
export function SidebarHeader({ onCollapse }: { onCollapse: () => void }) {
  const { text } = useI18n()
  return (
    <div className={cn('drag flex h-12 shrink-0 items-center justify-between gap-2 pr-3', isMac ? 'pl-20' : 'pl-3')}>
      <ModeSwitch />
      <IconButton icon={PanelLeft} label={withShortcut(text('收起侧边栏'), TOGGLE_SIDEBAR)} onClick={onCollapse} />
    </div>
  )
}

/** 代码模式（docs/ui/coding-mode.md）还没做：「代码」点了只提示制作中，始终停在「对话」。 */
function ModeSwitch() {
  const toast = useToast()
  // 轨道左边和下面的行同在 x=12；边框 1 + 内边距 3 + 左内边距 6，图标落在 x=22、字落在 x=48，和下面「新建任务」等行的图标、文字对齐
  const item = 'gap-2.5 pr-2.5 pl-1.5 text-list'
  return (
    <div role="group" aria-label={tr('sidebar.mode.group')} className={SEGMENT_TRACK}>
      <button type="button" aria-pressed className={cn(segmentItem(true), item)}>
        <MessagesSquare size={16} strokeWidth={1.5} className="shrink-0" />
        {tr('sidebar.mode.chat')}
      </button>
      <button
        type="button"
        aria-pressed={false}
        title={tr('sidebar.mode.codeWip')}
        onClick={() => toast(tr('sidebar.mode.codeWip'))}
        className={cn(segmentItem(false), item)}
      >
        <CodeXml size={16} strokeWidth={1.5} className="shrink-0" />
        {tr('sidebar.mode.code')}
      </button>
    </div>
  )
}
