import { useRef, useState } from 'react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { Button, Popover, PopoverItem, Switch } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { resetSidebarIcons, setSidebarIcon, setSidebarPrefs, useSidebarPrefs } from '@/features/appearance/sidebar'
import {
  DEFAULT_SIDEBAR_ICONS,
  SIDEBAR_ACTIONS,
  SIDEBAR_ICON_OPTIONS,
  getSidebarIcon,
  type SidebarAction,
  type SidebarIcons,
} from '@/features/appearance/sidebarIcons'
import { GroupTitle, SettingRow } from './SettingRow'
import { SidebarLayoutEditor } from './SidebarLayoutEditor'

/** 设置 → 外观 → 侧边栏；预览和真实侧栏共用当前偏好及图标映射。 */
export function SidebarSettings() {
  useI18n()
  const prefs = useSidebarPrefs()
  const isDefault = SIDEBAR_ACTIONS.every(action => prefs.icons[action] === DEFAULT_SIDEBAR_ICONS[action])
  return (
    <>
      <GroupTitle>{tr('sidebar.settings.title')}</GroupTitle>
      <SettingRow
        title={tr('sidebar.settings.showRecent')}
        description={tr('sidebar.settings.showRecentDescription')}
        control={
          <Switch
            checked={prefs.showRecent}
            label={tr('sidebar.settings.showRecent')}
            onChange={showRecent => setSidebarPrefs({ showRecent })}
          />
        }
      />
      <SettingRow title={tr('sidebar.layout.title')} description={tr('sidebar.layout.description')}>
        <SidebarLayoutEditor />
      </SettingRow>
      <SettingRow
        title={tr('sidebar.settings.icons')}
        description={tr('sidebar.settings.iconsDescription')}
        control={
          <Button variant="ghost" icon={RotateCcw} disabled={isDefault} onClick={resetSidebarIcons}>
            {tr('sidebar.settings.reset')}
          </Button>
        }
      >
        {/* 两列，每个入口一格：平时只显示当前图标和名字，点开挑样式（docs/ui/layout-v2.md §18） */}
        <div className="grid grid-cols-2 gap-2">
          {SIDEBAR_ACTIONS.map(action => (
            <IconPicker key={action} action={action} icons={prefs.icons} />
          ))}
        </div>
      </SettingRow>
    </>
  )
}

/** 一个入口：当前图标 + 名字 + ▾，点开列出全部样式（带名字），选中即关；焦点落在当前样式上，上下键移动，Esc 关闭 */
function IconPicker({ action, icons }: { action: SidebarAction; icons: SidebarIcons }) {
  useI18n()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const name = tr(`sidebar.action.${action}`)
  const Current = getSidebarIcon(action, icons)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  return (
    <div className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={tr('sidebar.settings.chooseIcon', { action: name, icon: tr(`sidebar.icon.${icons[action]}`) })}
        onClick={() => setOpen(o => !o)}
        className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md border border-line px-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:border-accent"
      >
        <Current size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-ui text-fg-secondary">{name}</span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-fg-faint" />
      </button>
      <Popover open={open} onClose={close} className="top-full left-0 mt-1 w-full">
        <div
          role="menu"
          aria-label={name}
          ref={el => el?.querySelector<HTMLElement>('[aria-checked=true]')?.focus()}
          onKeyDown={e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-menu-item]')]
            const i = items.indexOf(document.activeElement as HTMLElement)
            items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
          }}
        >
          {SIDEBAR_ICON_OPTIONS[action].map(id => {
            const Icon = getSidebarIcon(action, { ...icons, [action]: id })
            const checked = icons[action] === id
            return (
              <PopoverItem
                key={id}
                role="menuitemradio"
                checked={checked}
                selected={checked}
                icon={<Icon size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-fg-muted" />}
                hint={checked ? <Check size={14} aria-hidden="true" className="text-accent" /> : undefined}
                onClick={() => {
                  setSidebarIcon(action, id)
                  close()
                }}
              >
                {tr(`sidebar.icon.${id}`)}
              </PopoverItem>
            )
          })}
        </div>
      </Popover>
    </div>
  )
}
