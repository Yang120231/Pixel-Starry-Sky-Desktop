import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
// 7×7 像素网格里的一颗四角星（✦），右上角再点一颗小星
const STAR: Array<[number, number]> = [
  [3, 0],
  [3, 1],
  [2, 2],
  [3, 2],
  [4, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
  [6, 3],
  [2, 4],
  [3, 4],
  [4, 4],
  [3, 5],
  [3, 6],
]

/** 占位 Logo：圆角方块里一颗像素四角星（正式 Logo 以后设计）。颜色跟随主题 */
export function Logo({ size = 22 }: { size?: number }) {
  useI18n()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 11 11"
      shapeRendering="crispEdges"
      aria-label={tr('ui.Logo.pixelStarrySky')}
    >
      <rect width="11" height="11" rx="2.6" className="fill-fg" shapeRendering="geometricPrecision" />
      {STAR.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 2} y={y + 2} width="1" height="1" className="fill-wall-tint" />
      ))}
      <rect x="8" y="2" width="1" height="1" className="fill-wall-tint" opacity="0.55" />
    </svg>
  )
}
