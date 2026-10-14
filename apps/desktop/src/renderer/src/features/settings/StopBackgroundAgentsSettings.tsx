import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Switch } from '@/ui'
import { SettingRow } from './SettingRow'
import { setStopBackgroundAgents, useStopBackgroundAgents } from './stopBackgroundAgents'

export function StopBackgroundAgentsSettings() {
  useI18n()
  const enabled = useStopBackgroundAgents()
  return (
    <SettingRow
      title={tr('subagentStop.setting')}
      description={tr('subagentStop.settingHint')}
      control={<Switch checked={enabled} label={tr('subagentStop.setting')} onChange={setStopBackgroundAgents} />}
    />
  )
}
