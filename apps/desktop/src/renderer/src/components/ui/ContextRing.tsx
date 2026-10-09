import { useI18n } from '@/i18n/I18nProvider'
/** 上下文用量小圆环（状态栏的「◌ 12%」） */
export function ContextRing({ percent, size = 14 }: { percent: number; size?: number }) {
  useI18n()
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0 -rotate-90 text-fg-muted" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={`${(c * percent) / 100} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  )
}
