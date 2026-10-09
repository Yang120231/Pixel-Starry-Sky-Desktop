import { useI18n } from '@/i18n/I18nProvider'
interface SliderProps {
  /** 无障碍名称 */
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  /** 右侧显示的数值文字，例如「45%」 */
  display: string
}

/** 滑块：原生 range，强调色跟随主题；右侧显示当前值 */
export function Slider({ label, value, min, max, step = 1, onChange, display }: SliderProps) {
  useI18n()
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-56 cursor-pointer accent-accent"
      />
      <span className="w-12 text-right text-meta text-fg-muted tabular-nums">{display}</span>
    </div>
  )
}
