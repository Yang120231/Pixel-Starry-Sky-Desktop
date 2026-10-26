/** 输入框里的上下文用量小圆环（20px，和 36px 的胶囊对齐）；≥ 80% 变警告色。百分比和读屏文字由调用方算好（ui 不导入 data） */
export function ContextRing({ percent, label }: { percent: number; label: string }) {
  const r = 8
  const c = 2 * Math.PI * r
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      role="img"
      aria-label={label}
      className={`shrink-0 -rotate-90 ${percent >= 80 ? 'text-warn' : 'text-fg-muted'}`}
    >
      <title>{label}</title>
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={`${(c * percent) / 100} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  )
}
