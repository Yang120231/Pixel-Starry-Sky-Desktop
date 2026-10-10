// 截图标注的图形和绘制（docs/ui/rewind-fork-sidechat.md §6）：纯数据 + 画到 canvas 上，坐标都是图片像素
export type Tool = 'box' | 'arrow' | 'text'
export type Size = 'small' | 'medium' | 'large'

/** 画进图片里的颜色：设计变量 --annotate-*（深浅主题一样，因为是图片内容） */
export const COLOR_NAMES = ['red', 'orange', 'yellow', 'blue'] as const
export type ColorName = (typeof COLOR_NAMES)[number]

export const colorVar = (name: ColorName | 'outline'): string => `var(--annotate-${name})`

/** canvas 不认 var()，画之前取出实际颜色 */
function resolve(name: ColorName | 'outline'): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--annotate-${name}`).trim() || 'red'
}

export type Shape =
  | { kind: 'box' | 'arrow'; x1: number; y1: number; x2: number; y2: number; color: ColorName; size: Size }
  | { kind: 'text'; x: number; y: number; text: string; color: ColorName; size: Size }

/** 线宽随图片大小：小图细、大截图粗一些 */
export function lineWidth(width: number, height: number, size: Size): number {
  const base = Math.max(2, Math.round(Math.min(width, height) / 320))
  return base * (size === 'small' ? 1 : size === 'medium' ? 2 : 3)
}

export function fontSize(width: number, height: number, size: Size): number {
  return lineWidth(width, height, size) * 6 + 8
}

/** 太小的框 / 箭头（误点）不算 */
export function tooSmall(shape: Shape): boolean {
  return shape.kind !== 'text' && Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 4
}

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], width: number, height: number): void {
  for (const s of shapes) {
    const color = resolve(s.color)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (s.kind === 'text') {
      const px = fontSize(width, height, s.size)
      ctx.font = `600 ${px}px system-ui, sans-serif`
      ctx.textBaseline = 'top'
      // 白色描边，深浅背景上都看得清
      ctx.lineWidth = Math.max(2, px / 6)
      ctx.strokeStyle = resolve('outline')
      ctx.strokeText(s.text, s.x, s.y)
      ctx.fillText(s.text, s.x, s.y)
      continue
    }
    const w = lineWidth(width, height, s.size)
    ctx.lineWidth = w
    if (s.kind === 'box') {
      ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))
      continue
    }
    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
    const head = w * 4 + 6
    ctx.beginPath()
    ctx.moveTo(s.x1, s.y1)
    ctx.lineTo(s.x2 - Math.cos(angle) * head * 0.6, s.y2 - Math.sin(angle) * head * 0.6)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(s.x2, s.y2)
    ctx.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 7), s.y2 - head * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 7), s.y2 - head * Math.sin(angle + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
  }
}
