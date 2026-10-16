import { useSyncExternalStore, type JSX } from 'react'
import { Select } from '@/ui'
import { tr } from '@/i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { usePackState } from '@/features/extpacks/store'
import {
  editorThemeOptions,
  editorThemesAvailable,
  getEditorThemeChoice,
  onEditorThemeChoiceChange,
  setEditorThemeChoice,
} from '@/features/editor/code/colorTheme/store'
import { SettingRow } from './SettingRow'

const FOLLOW = '__follow__'

// getEditorThemeChoice 每次返回新对象，useSyncExternalStore 要稳定的快照，所以用序列化后的字符串
const snapshot = (): string => JSON.stringify(getEditorThemeChoice())

/** 设置 › 外观里的代码配色：深色、浅色各选一个颜色主题；没有启用着的代码配色扩展就不显示 */
export function EditorThemeSettings(): JSX.Element | null {
  const { locale } = useI18n()
  const state = usePackState()
  const choice = JSON.parse(useSyncExternalStore(onEditorThemeChoiceChange, snapshot, snapshot)) as ReturnType<
    typeof getEditorThemeChoice
  >
  const dark = editorThemeOptions(state, 'dark', locale)
  const light = editorThemeOptions(state, 'light', locale)
  if (!editorThemesAvailable(state)) return null

  const row = (mode: 'dark' | 'light', options: typeof dark) => {
    const value = choice[mode]
    // 选中的主题所在扩展被停用 / 移除了：留一个「已不可用」的占位，免得下拉显示成空白
    const known = value && options.some(o => o.value === value)
    const missing = value && !known ? [{ value, label: value }] : []
    return (
      <Select
        label={tr(mode === 'dark' ? 'editorTheme.whenDark' : 'editorTheme.whenLight')}
        value={value ?? FOLLOW}
        fitContent
        options={[{ value: FOLLOW, label: tr('editorTheme.followPalette') }, ...options, ...missing]}
        onChange={v => setEditorThemeChoice(mode, v === FOLLOW ? null : v)}
      />
    )
  }

  return (
    <SettingRow title={tr('extensions.appearance.editorTheme')} description={tr('editorTheme.description')}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-meta text-fg-muted">{tr('editorTheme.whenDark')}</span>
          {row('dark', dark)}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-meta text-fg-muted">{tr('editorTheme.whenLight')}</span>
          {row('light', light)}
        </div>
      </div>
    </SettingRow>
  )
}
