import { describe, expect, it } from 'vitest'
import { fontSize, lineWidth, tooSmall } from './annotate'

describe('截图标注', () => {
  it('线宽随图片大小和粗细档位变化，至少 2px', () => {
    expect(lineWidth(400, 300, 'small')).toBe(2)
    expect(lineWidth(400, 300, 'large')).toBe(6)
    expect(lineWidth(2560, 1440, 'medium')).toBe(Math.round(1440 / 320) * 2)
    expect(fontSize(400, 300, 'small')).toBe(20)
  })

  it('误点出来的极小框和箭头不算，文字不受影响', () => {
    expect(tooSmall({ kind: 'box', x1: 1, y1: 1, x2: 2, y2: 3, color: 'red', size: 'small' })).toBe(true)
    expect(tooSmall({ kind: 'arrow', x1: 0, y1: 0, x2: 30, y2: 0, color: 'red', size: 'small' })).toBe(false)
    expect(tooSmall({ kind: 'text', x: 0, y: 0, text: 'a', color: 'red', size: 'small' })).toBe(false)
  })
})
