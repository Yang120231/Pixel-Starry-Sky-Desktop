import { PanelLeft } from 'lucide-react'
import { IconButton, cn } from '@/ui'
import { ModeSwitch } from '@/features/layout/ModeSwitch'
import { TOGGLE_SIDEBAR, withShortcut } from '@/features/layout/shortcuts'
import { useI18n } from '@/i18n/I18nProvider'

const isMac = window.pixelsky?.platform === 'darwin'

/** 顶部 48px：左边「对话 | 代码」切换（docs/ui/layout-v2.md §5），右边收起按钮。 */
export function SidebarHeader({ onCollapse }: { onCollapse: () => void }) {
  const { text } = useI18n()
  return (
    <div className={cn('drag flex h-12 shrink-0 items-center justify-between gap-2 pr-3', isMac ? 'pl-20' : 'pl-3')}>
      <ModeSwitch variant="sidebar" />
      <IconButton icon={PanelLeft} label={withShortcut(text('收起侧边栏'), TOGGLE_SIDEBAR)} onClick={onCollapse} />
    </div>
  )
}
