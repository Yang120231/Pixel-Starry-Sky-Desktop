import { RotateCcw } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { resetSidebarIcons, setSidebarIcon, setSidebarPrefs, useSidebarPrefs } from '@/appearance/sidebar'
import { DEFAULT_SIDEBAR_ICONS, SIDEBAR_ACTIONS, SIDEBAR_ICON_OPTIONS, getSidebarIcon } from '@/appearance/sidebarIcons'
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
          <button
            type="button"
            role="switch"
            aria-label={tr('sidebar.settings.showRecent')}
            aria-checked={prefs.showRecent}
            onClick={() => setSidebarPrefs({ showRecent: !prefs.showRecent })}
            className={cn(
              'no-drag relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              prefs.showRecent ? 'bg-primary' : 'bg-subtle ring-1 ring-inset ring-line-strong',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-5 rounded-full bg-surface shadow-sm',
                prefs.showRecent ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        }
      />
      <SettingRow title={tr('sidebar.layout.title')} description={tr('sidebar.layout.description')}>
        <SidebarLayoutEditor />
      </SettingRow>
      <SettingRow title={tr('sidebar.settings.icons')} description={tr('sidebar.settings.iconsDescription')}>
        <div className="space-y-2">
          {SIDEBAR_ACTIONS.map(action => (
            <fieldset
              key={action}
              className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-line px-3 py-2"
            >
              <legend className="sr-only">{tr(`sidebar.action.${action}`)}</legend>
              <span className="text-ui text-fg-secondary" aria-hidden="true">
                {tr(`sidebar.action.${action}`)}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {SIDEBAR_ICON_OPTIONS[action].map(id => {
                  const Icon = getSidebarIcon(action, { ...prefs.icons, [action]: id })
                  const label = tr('sidebar.settings.chooseIcon', {
                    action: tr(`sidebar.action.${action}`),
                    icon: tr(`sidebar.icon.${id}`),
                  })
                  return (
                    <label
                      key={id}
                      title={label}
                      className="relative inline-flex size-9 cursor-pointer items-center justify-center"
                    >
                      <input
                        type="radio"
                        name={`sidebar-icon-${action}`}
                        aria-label={label}
                        value={id}
                        checked={prefs.icons[action] === id}
                        onChange={() => setSidebarIcon(action, id)}
                        className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-md border border-transparent hover:bg-hover checked:border-accent checked:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      />
                      <Icon
                        size={17}
                        strokeWidth={1.5}
                        aria-hidden="true"
                        className="pointer-events-none relative text-fg-muted peer-checked:text-accent"
                      />
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <Button
          variant="ghost"
          icon={RotateCcw}
          className="mt-3 -ml-3"
          disabled={isDefault}
          onClick={resetSidebarIcons}
        >
          {tr('sidebar.settings.reset')}
        </Button>
      </SettingRow>
    </>
  )
}
