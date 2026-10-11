import { useMemo } from 'react'
import { encode } from 'uqr'
import { useTheme } from '../../appearance/ThemeProvider'

/**
 * 二维码：深色模块画在浅色底上（扫码器大多不认反色的码）。M1 截图后用 jsQR 核对过两种主题都能扫。
 * 只用设计变量：浅色主题用 surface 底 + fg 模块；深色主题两者对调，仍然是「浅底深码」。
 */
export function QrCode({ text, label, scale = 4 }: { text: string; label: string; scale?: number }) {
  const { resolved } = useTheme()
  // 四周留 4 格空白（规范要求）；每格整数像素，不然边缘发虚、扫不出来
  const qr = useMemo(() => encode(text, { ecc: 'L', border: 4 }), [text])
  const size = qr.size * scale
  const path = useMemo(() => {
    let d = ''
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return d
  }, [qr])
  const dark = resolved === 'dark'
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className={dark ? 'rounded-md bg-fg fill-surface' : 'rounded-md bg-surface fill-fg ring-1 ring-line'}
    >
      <path d={path} />
    </svg>
  )
}
