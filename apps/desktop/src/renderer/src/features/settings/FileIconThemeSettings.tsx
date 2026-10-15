import type { JSX } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Select } from '@/ui'
import { usePackState } from '@/features/extpacks/store'
import {
  effectiveIconChoice,
  iconThemeOptions,
  setIconThemeChoice,
  useIconThemeChoice,
} from '@/features/files/icons/store'
import { SettingRow } from './SettingRow'

/** 设置 › 外观：文件图标（Material / 简单 / 扩展里的图标主题），docs/ui/file-tree-icons.md §3.3 */
export function FileIconThemeSettings(): JSX.Element | null {
  const { locale } = useI18n()
  const state = usePackState()
  const choice = useIconThemeChoice()
  const options = iconThemeOptions(state, locale)
  return (
    <SettingRow title={tr('extensions.appearance.fileIcons')} description={tr('fileIcons.description')}>
      <Select
        label={tr('extensions.appearance.fileIcons')}
        value={effectiveIconChoice(choice, state)}
        options={options}
        onChange={setIconThemeChoice}
        fitContent
      />
    </SettingRow>
  )
}
