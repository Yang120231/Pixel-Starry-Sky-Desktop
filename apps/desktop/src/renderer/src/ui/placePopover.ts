export type PopoverSide = 'bottom' | 'top' | 'right' | 'left'
export type PopoverAlign = 'start' | 'end'

export interface PlaceRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface PlaceOptions {
  side?: PopoverSide
  align?: PopoverAlign
  /** 和锚点之间的间隙（px），默认 4 */
  offset?: number
  /** 离视口边缘至少留多少（px），默认 8 */
  margin?: number
  /** 上下弹出时横向尽量留在这个范围里（例如锚点所在的窗格）；放不下时只夹在视口内 */
  within?: { left: number; right: number }
}

export interface Placement {
  top: number
  left: number
  /** 可用的最大高度；内容比它矮时调用方不必限制 */
  maxHeight: number
  /** 最终用的那一边（放不下时会翻到对面） */
  side: PopoverSide
}

/**
 * 弹出层的位置计算（纯函数）：靠锚点的 side 边放；放不下而对面更宽裕时翻到对面；
 * 横向 / 纵向夹在视口内（留 margin）；maxHeight 是该方向上剩下的高度。
 * align 'start' 对齐锚点的左边 / 上边，'end' 对齐右边 / 下边。
 */
export function placePopover(
  anchor: PlaceRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: PlaceOptions = {},
): Placement {
  const { side = 'bottom', align = 'start', offset = 4, margin = 8, within } = opts
  const vertical = side === 'bottom' || side === 'top'
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)))
  let used: PopoverSide = side
  if (vertical) {
    const room = {
      bottom: viewport.height - anchor.bottom - offset - margin,
      top: anchor.top - offset - margin,
    }
    const opposite = side === 'bottom' ? 'top' : 'bottom'
    if (size.height > room[side] && room[opposite] > room[side]) used = opposite
    const maxHeight = Math.max(0, room[used as 'top' | 'bottom'])
    const height = Math.min(size.height, maxHeight)
    const top = used === 'bottom' ? anchor.bottom + offset : anchor.top - offset - height
    const rawLeft = align === 'end' ? anchor.right - size.width : anchor.left
    let lo = margin,
      hi = viewport.width - size.width - margin
    if (within) {
      const l = Math.max(lo, within.left + margin),
        r = Math.min(hi, within.right - size.width - margin)
      if (l <= r) [lo, hi] = [l, r]
    }
    return { top, left: clamp(rawLeft, lo, hi), maxHeight, side: used }
  }
  const room = {
    right: viewport.width - anchor.right - offset - margin,
    left: anchor.left - offset - margin,
  }
  const opposite = side === 'right' ? 'left' : 'right'
  if (size.width > room[side] && room[opposite] > room[side]) used = opposite
  const left = used === 'right' ? anchor.right + offset : anchor.left - offset - size.width
  const maxHeight = Math.max(0, viewport.height - margin * 2)
  const height = Math.min(size.height, maxHeight)
  const rawTop = align === 'end' ? anchor.bottom - height : anchor.top
  return { top: clamp(rawTop, margin, viewport.height - height - margin), left, maxHeight, side: used }
}
