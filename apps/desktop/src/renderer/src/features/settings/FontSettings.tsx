import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Button, Segmented, type SegmentedOption } from '@/ui'
import { DEFAULT_FONTS, FONT_SCALES, resetFontPrefs, setFontPrefs, useFontPrefs } from '@/features/appearance/fonts'
import { FontPicker } from './FontPicker'
import { SettingRow } from './SettingRow'

const SCALE_OPTIONS: Array<SegmentedOption<string>> = FONT_SCALES.map(s => ({
  value: String(s),
  label: `${Math.round(s * 100)}%`,
}))

const SERIF_OPTIONS: Array<SegmentedOption<'on' | 'off'>> = [
  {
    value: 'off',
    get label() {
      return tr('settings.motion.off')
    },
  },
  {
    value: 'on',
    get label() {
      return tr('settings.FontSettings.message796')
    },
  },
]

/** 外观 → 字体：界面字体、代码字体、字号、对话正文衬线体（docs/ui/settings.md §7） */
export function FontSettings() {
  useI18n()
  const f = useFontPrefs()
  const isDefault =
    f.sans === DEFAULT_FONTS.sans &&
    f.mono === DEFAULT_FONTS.mono &&
    f.scale === DEFAULT_FONTS.scale &&
    f.serifProse === DEFAULT_FONTS.serifProse

  return (
    <>
      <SettingRow title={tr('settings.FontSettings.message797')} description={tr('settings.FontSettings.message798')}>
        <FontPicker
          label={tr('settings.FontSettings.message797')}
          value={f.sans}
          onChange={sans => setFontPrefs({ sans })}
          placeholder={tr('settings.FontSettings.message799')}
          sample={tr('settings.FontSettings.message800')}
        />
      </SettingRow>
      <SettingRow title={tr('settings.FontSettings.message801')} description={tr('settings.FontSettings.message802')}>
        <FontPicker
          label={tr('settings.FontSettings.message801')}
          value={f.mono}
          onChange={mono => setFontPrefs({ mono })}
          placeholder={tr('settings.FontSettings.message803')}
          sample="const a = 0x1f;"
        />
      </SettingRow>
      <SettingRow title={tr('settings.FontSettings.message804')} description={tr('settings.FontSettings.message805')}>
        <Segmented
          label={tr('settings.FontSettings.message804')}
          options={SCALE_OPTIONS}
          value={String(f.scale)}
          onChange={v => setFontPrefs({ scale: Number(v) })}
        />
      </SettingRow>
      <SettingRow title={tr('settings.FontSettings.message806')} description={tr('settings.FontSettings.message807')}>
        <Segmented
          label={tr('settings.FontSettings.message806')}
          options={SERIF_OPTIONS}
          value={f.serifProse ? 'on' : 'off'}
          onChange={v => setFontPrefs({ serifProse: v === 'on' })}
        />
      </SettingRow>
      {!isDefault && (
        <div className="-mt-2 pb-2">
          <Button variant="ghost" className="-ml-3" onClick={resetFontPrefs}>
            {tr('settings.FontSettings.message808')}{' '}
          </Button>
        </div>
      )}
    </>
  )
}
