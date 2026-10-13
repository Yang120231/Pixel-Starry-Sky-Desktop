import { useI18n } from '@/i18n/I18nProvider'
import { SEGMENT_TRACK, cn } from '@/ui'
import { isMac } from '@/features/layout/keybindings'
import { LayoutActionButton } from '@/features/layout/LayoutActionButton'
import { ModeSwitch } from '@/features/layout/ModeSwitch'
import { ToolbarContext } from '@/features/layout/ToolbarContext'
import { MachineSwitch } from '@/features/machines/MachineSwitch'
import { useSidebarPrefs } from '@/features/appearance/sidebar'
import { BranchWidget, CommandCenterButton, ProjectWidget, RunWidget } from '../topbar'

const TOOLBAR_STATE = { panelOpen: false }

/** 代码模式顶栏：模式切换 + 项目 / 分支，中间命令中心，右边运行 / 机器 / 打开方式（高 48） */
export function CodingTopBar() {
  useI18n()
  const { layout } = useSidebarPrefs()
  return (
    <header
      data-coding-topbar
      className={cn(
        'drag @container flex h-12 shrink-0 items-center gap-2 border-b border-line-layout bg-sidebar',
        isMac ? 'pl-20' : 'pl-2',
      )}
      style={{ paddingRight: 'calc(var(--titlebar-reserve) + 8px)' }}
    >
      <div className="no-drag flex shrink-0 items-center gap-2">
        <ModeSwitch variant="topbar" />
        <ProjectWidget />
        <BranchWidget />
      </div>
      <span className="flex-1" />
      <div className="no-drag flex min-w-0 shrink items-center">
        <CommandCenterButton />
      </div>
      <span className="flex-1" />
      <div className="no-drag flex shrink-0 items-center gap-0.5">
        <RunWidget />
        <MachineSwitch />
        {/* 用户的图标位置设置照样生效；代码模式没有右侧面板开关 */}
        {layout.header.length > 0 && (
          <div data-header-group className={SEGMENT_TRACK}>
            <ToolbarContext.Provider value={TOOLBAR_STATE}>
              {layout.header.map(action => (
                <LayoutActionButton key={action} action={action} placement="header" />
              ))}
            </ToolbarContext.Provider>
          </div>
        )}
      </div>
    </header>
  )
}
