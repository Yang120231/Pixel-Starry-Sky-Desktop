import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Check } from 'lucide-react'
import { cn } from '@/ui'
import { SettingRow } from './SettingRow'
import { PALETTES, setPalette, usePalette, type Palette } from '@/features/appearance/palette'

/** 第三方配色用原名，不翻译 */
const NAMES: Record<Palette, string | null> = {
  default: null,
  github: 'GitHub',
  solarized: 'Solarized',
  nord: 'Nord',
  catppuccin: 'Catppuccin',
  gruvbox: 'Gruvbox',
  tokyonight: 'Tokyo Night',
  rosepine: 'Rosé Pine',
}
const paletteName = (value: Palette): string => NAMES[value] ?? tr('settings.PaletteSettings.default')

/** 配色主题：每张卡片按当前浅色 / 深色画出这套配色的缩略界面（tokens.css 的 [data-palette-preview]） */
export function PaletteSettings() {
  useI18n()
  const selected = usePalette()
  return (
    <SettingRow title={tr('settings.PaletteSettings.palette')} description={tr('settings.PaletteSettings.description')}>
      <div
        role="radiogroup"
        aria-label={tr('settings.PaletteSettings.palette')}
        className="grid grid-cols-4 gap-3 @max-[720px]:grid-cols-3 @max-[520px]:grid-cols-2"
      >
        {PALETTES.map(value => {
          const name = paletteName(value)
          const active = selected === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={tr('settings.PaletteSettings.choosePalette', { p0: name })}
              onClick={() => setPalette(value)}
              className={cn(
                'rounded-lg border p-1.5 text-left hover:border-line-strong',
                active ? 'border-accent-line bg-accent-soft/40' : 'border-line-card',
              )}
            >
              <PalettePreview value={value} />
              <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5 text-meta text-fg">
                <span className="truncate">{name}</span>
                {active && <Check size={13} className="shrink-0 text-accent-fg" />}
              </div>
            </button>
          )
        })}
      </div>
    </SettingRow>
  )
}

/** 缩略界面：侧栏、主区、一张卡片、两行字、主色按钮。颜色全部在预览元素自己身上取。 */
function PalettePreview({ value }: { value: Palette }) {
  return (
    <div
      aria-hidden
      data-palette-preview={value}
      className="flex h-16 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-app)]"
    >
      <div className="flex w-1/4 flex-col gap-1 bg-[var(--bg-sidebar)] p-1.5">
        <span className="h-1 w-full rounded-full bg-[var(--text-faint)]" />
        <span className="h-1 w-3/4 rounded-full bg-[var(--theme-accent)]" />
        <span className="h-1 w-full rounded-full bg-[var(--text-faint)]" />
      </div>
      <div className="flex flex-1 flex-col justify-end p-1.5">
        <div className="flex items-end justify-between gap-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] p-1.5">
          <div className="flex flex-1 flex-col gap-1">
            <span className="h-1 w-4/5 rounded-full bg-[var(--text)]" />
            <span className="h-1 w-1/2 rounded-full bg-[var(--text-muted)]" />
          </div>
          <span className="size-2.5 shrink-0 rounded-full bg-[var(--theme-accent)]" />
        </div>
      </div>
    </div>
  )
}
