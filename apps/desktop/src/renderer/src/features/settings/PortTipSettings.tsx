import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { SettingRow, Toggle } from './SettingRow'
import { setPortTipOff, usePortTipOff } from '@/features/session/live/portTipSwitch'

/** 设置 › 外观 › 对话：命令输出里发现本机页面时提示（提示条「⋯ › 不再提示」后从这里打开回来，docs/ui/port-preview.md §7） */
export function PortTipSettings() {
  useI18n()
  const off = usePortTipOff()
  return (
    <SettingRow
      title={tr('portTip.setting.title')}
      description={tr('portTip.setting.desc')}
      control={<Toggle label={tr('portTip.setting.title')} checked={!off} onChange={on => setPortTipOff(!on)} />}
    />
  )
}
