import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'

/**
 * 应用标志：深色圆角方块里一个单线 P，右上一颗浅橙四角星（docs/brand/logo-replacement.md）。
 * 和应用图标是同一套图形（scripts/make-brand-icons.mjs），改图形时两边一起改。颜色固定、不跟主题；
 * 深色主题下方块和界面底色几乎一样，外圈描一道 --border-card 的细边勾出轮廓（浅色主题下看不出来）
 */
export function Logo({ size = 22 }: { size?: number }) {
  useI18n()
  return (
    <svg width={size} height={size} viewBox="-16 -15 70 70" role="img" aria-label={tr('ui.Logo.pixelStarrySky')}>
      <rect x="-16" y="-15" width="70" height="70" rx="16.5" fill="#1d1915" />
      <rect
        x="-15.5"
        y="-14.5"
        width="69"
        height="69"
        rx="16"
        fill="none"
        strokeWidth="1"
        style={{ stroke: 'var(--border-card)' }}
      />
      <path
        d="M0 40V0H11A11.5 11.5 0 0 1 11 23H0"
        fill="none"
        stroke="#f4efe8"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M34 -1.75Q35.4 3.85 41 5.25Q35.4 6.65 34 12.25Q32.6 6.65 27 5.25Q32.6 3.85 34 -1.75Z"
        fill="#f0a764"
        stroke="#f0a764"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
