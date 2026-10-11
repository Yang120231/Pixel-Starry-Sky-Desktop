import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Segmented } from '@/ui'
import { SettingRow } from './SettingRow'

type CloseAction = 'hide' | 'quit'

/** 关闭主窗口时：隐藏到托盘（任务继续）或退出（docs/ui/tray.md §2.3）。设置存在主进程，演示 / 浏览器里不显示 */
export function CloseActionSettings() {
  useI18n()
  const tray = window.pixelsky?.tray
  const [value, setValue] = useState<CloseAction | null>(null)
  useEffect(() => {
    if (!tray) return
    let alive = true
    void tray
      .prefs()
      .then(p => alive && setValue(p.closeToTray ? 'hide' : 'quit'))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [tray])
  if (!tray || value === null) return null
  return (
    <SettingRow title={tr('tray.closeAction')} description={tr('tray.closeActionDescription')}>
      <Segmented
        label={tr('tray.closeAction')}
        options={[
          { value: 'hide', label: tr('tray.closeHide') },
          { value: 'quit', label: tr('tray.closeQuit') },
        ]}
        value={value}
        onChange={next => {
          setValue(next)
          void tray
            .setPrefs({ closeToTray: next === 'hide' })
            .then(p => setValue(p.closeToTray ? 'hide' : 'quit'))
            .catch(() => undefined)
        }}
      />
    </SettingRow>
  )
}
