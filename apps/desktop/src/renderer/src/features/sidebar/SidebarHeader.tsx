import { ChevronDown, PanelLeft } from 'lucide-react'
import { IconButton, cn } from '@/ui'
import { brandName } from '@/data'
import { TOGGLE_SIDEBAR, withShortcut } from '@/features/layout/shortcuts'
import { useI18n } from '@/i18n/I18nProvider'
import { openWorkspacePicker } from '@/features/machines/store'
import { useActiveWorkspace } from '@/features/editor/target'

const isMac = window.pixelsky?.platform === 'darwin'

/** 顶部 48px：英文品牌工作区切换器 + 收起按钮。 */
export function SidebarHeader({ onCollapse }: { onCollapse: () => void }) {
  const { text } = useI18n()
  const workspace = useActiveWorkspace()
  return (
    <div className={cn('drag flex h-12 shrink-0 items-center justify-between gap-2 pr-3', isMac ? 'pl-20' : 'pl-3')}>
      <button
        type="button"
        onClick={() => openWorkspacePicker()}
        aria-label={text('切换工作区')}
        title={workspace.path || text('切换工作区')}
        className="press no-drag flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-ui font-semibold text-fg hover:bg-hover"
      >
        <span className="truncate">{brandName}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      </button>
      <IconButton icon={PanelLeft} label={withShortcut(text('收起侧边栏'), TOGGLE_SIDEBAR)} onClick={onCollapse} />
    </div>
  )
}
