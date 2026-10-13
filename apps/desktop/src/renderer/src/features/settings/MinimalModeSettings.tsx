import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Segmented } from '@/ui'
import { useTheme } from '@/features/appearance/ThemeProvider'
import type { MinimalMode } from '@/features/appearance/minimalMode'
import { SettingRow } from './SettingRow'

/** 设置 › 外观：极简模式（docs/ui/minimal-mode.md），和配色互不绑定 */
export function MinimalModeSettings() {
  useI18n()
  const { minimal, setMinimal } = useTheme()
  const options: { value: MinimalMode; label: string }[] = [
    { value: 'on', label: tr('minimal.on') },
    { value: 'off', label: tr('minimal.off') },
  ]
  return (
    <SettingRow title={tr('minimal.setting')} description={tr('minimal.settingHint')}>
      <Segmented label={tr('minimal.setting')} options={options} value={minimal} onChange={setMinimal} />
    </SettingRow>
  )
}
