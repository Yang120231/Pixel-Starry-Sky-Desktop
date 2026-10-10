import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Segmented } from '@/ui'
import { SettingRow } from './SettingRow'
import { setTurnRailSide, useTurnRailSide, type TurnRailSide } from './turnRail'

/** 设置 › 外观 › 对话：轮次跳转条放哪边（docs/ui/turn-rail.md §3） */
export function TurnRailSettings() {
  useI18n()
  const side = useTurnRailSide()
  const options: { value: TurnRailSide; label: string }[] = [
    { value: 'left', label: tr('turnRail.left') },
    { value: 'right', label: tr('turnRail.right') },
    { value: 'off', label: tr('turnRail.off') },
  ]
  return (
    <SettingRow title={tr('turnRail.setting')} description={tr('turnRail.settingHint')}>
      <Segmented label={tr('turnRail.setting')} options={options} value={side} onChange={setTurnRailSide} />
    </SettingRow>
  )
}
