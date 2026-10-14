import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { SettingRow, Toggle } from './SettingRow'
import { setFullAccessConfirm, useFullAccessConfirm } from '@/features/session/fullAccess'

/** 设置 › 外观 › 对话：切到完全放行前先确认（在确认里勾了「以后不再提醒」后从这里打开回来，docs/ui/full-access-confirm.md） */
export function FullAccessConfirmSettings() {
  useI18n()
  const ask = useFullAccessConfirm()
  return (
    <SettingRow
      title={tr('fullAccess.setting.title')}
      description={tr('fullAccess.setting.desc')}
      control={<Toggle label={tr('fullAccess.setting.title')} checked={ask} onChange={setFullAccessConfirm} />}
    />
  )
}
