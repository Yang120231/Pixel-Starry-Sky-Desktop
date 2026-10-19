import type { QuotaBar, QuotaLevel } from './quotaModel'

const FILL: Record<QuotaLevel, string> = { normal: 'var(--accent)', warn: 'var(--warn)', full: 'var(--danger)' }

/**
 * 按钮图标：两根小进度条（上 5 小时，下最紧的周额度；只有一种时一根，没有数据时两根空条）。
 * 16px SVG，条宽最少 2px，颜色跟着各自的级别（样稿 meter()）。
 */
export function QuotaMeter({ bars }: { bars: readonly QuotaBar[] }) {
  const list: readonly QuotaBar[] = bars.length
    ? bars
    : [
        { percent: 0, level: 'normal' },
        { percent: 0, level: 'normal' },
      ]
  const ys = list.length === 1 ? [6] : [3.5, 9]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      {list.slice(0, 2).map((bar, i) => {
        const width = Math.max(bar.percent > 0 ? 2 : 0, Math.min(14, (14 * bar.percent) / 100))
        return (
          <g key={i}>
            <rect x="1" y={ys[i]} width="14" height="3.5" rx="1.75" fill="currentColor" opacity=".28" />
            {width > 0 && <rect x="1" y={ys[i]} width={width} height="3.5" rx="1.75" fill={FILL[bar.level]} />}
          </g>
        )
      })}
    </svg>
  )
}
