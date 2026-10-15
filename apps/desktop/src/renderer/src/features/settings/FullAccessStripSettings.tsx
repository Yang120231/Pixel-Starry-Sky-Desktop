import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { SettingRow, Toggle } from './SettingRow'
import { setFullAccessStripDismissed, useFullAccessStripDismissed } from '@/features/session/fullAccessStripState'

/** 设置 › 外观 › 对话：完全放行时在输入框上方提示（提示条或确认里选了「不再提示」后从这里打开回来） */
export function FullAccessStripSettings() {
  useI18n()
  const dismissed = useFullAccessStripDismissed()
  return (
    <SettingRow
      title={tr('fullAccess.setting.title')}
      description={tr('fullAccess.setting.desc')}
      control={
        <Toggle
          label={tr('fullAccess.setting.title')}
          checked={!dismissed}
          onChange={on => setFullAccessStripDismissed(!on)}
        />
      }
    />
  )
}
