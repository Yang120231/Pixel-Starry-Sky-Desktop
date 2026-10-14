// 看图浮层的缩放 / 平移计算（ui/ImageViewer.tsx 用，docs/ui/image-viewer.md §3）。纯函数。
// 坐标都以视口中心为原点：图片画在 translate(x, y) scale(scale)，x / y 是图片中心相对视口中心的偏移。

export const MIN_SCALE = 0.1
export const MAX_SCALE = 8
/** + / - 和工具栏按钮每次乘除这么多 */
export const STEP = 1.25

export interface Size {
  width: number
  height: number
}
export interface View {
  scale: number
  x: number
  y: number
}

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/** 适应窗口：放得下就按原始大小（小图不放大），放不下就等比缩小 */
export function fitScale(image: Size, viewport: Size): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  return clampScale(Math.min(1, viewport.width / image.width, viewport.height / image.height))
}

/** 平移限制：图比视口小的方向居中；大的方向不让边拖进视口里 */
export function clampPan(view: View, image: Size, viewport: Size): View {
  const limit = (offset: number, imageLength: number, viewportLength: number): number => {
    const room = (imageLength * view.scale - viewportLength) / 2
    return room <= 0 ? 0 : Math.min(room, Math.max(-room, offset))
  }
  return {
    scale: view.scale,
    x: limit(view.x, image.width, viewport.width),
    y: limit(view.y, image.height, viewport.height),
  }
}

/** 缩放到 next，鼠标所在的点（相对视口中心）在图上的位置不动 */
export function zoomAt(view: View, next: number, point: { x: number; y: number }, image: Size, viewport: Size): View {
  const scale = clampScale(next)
  const ratio = scale / view.scale
  return clampPan(
    { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio },
    image,
    viewport,
  )
}

/** 适应窗口的视图（居中） */
export const fitView = (image: Size, viewport: Size): View => ({ scale: fitScale(image, viewport), x: 0, y: 0 })

/** 滚轮一格的缩放倍数：deltaY 向上为放大；触控板的小步长按比例缩小 */
export const wheelFactor = (deltaY: number): number => Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.0025)
