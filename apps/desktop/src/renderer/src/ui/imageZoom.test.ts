import { describe, expect, it } from 'vitest'
import { clampPan, fitScale, fitView, MAX_SCALE, MIN_SCALE, wheelFactor, zoomAt } from './imageZoom'

const viewport = { width: 800, height: 600 }

describe('看图缩放', () => {
  it('适应窗口：大图等比缩小，小图不放大', () => {
    expect(fitScale({ width: 1600, height: 600 }, viewport)).toBe(0.5)
    expect(fitScale({ width: 400, height: 1200 }, viewport)).toBe(0.5)
    expect(fitScale({ width: 200, height: 100 }, viewport)).toBe(1)
    expect(fitScale({ width: 0, height: 0 }, viewport)).toBe(1)
    expect(fitView({ width: 1600, height: 1200 }, viewport)).toEqual({ scale: 0.5, x: 0, y: 0 })
  })

  it('以鼠标点为中心缩放：那个点在图上的位置不变', () => {
    const image = { width: 2000, height: 2000 }
    const before = { scale: 1, x: 0, y: 0 }
    const point = { x: 100, y: -50 }
    const after = zoomAt(before, 2, point, image, viewport)
    // 屏幕上的点 → 图上的坐标：(point - offset) / scale
    expect((point.x - after.x) / after.scale).toBeCloseTo((point.x - before.x) / before.scale)
    expect((point.y - after.y) / after.scale).toBeCloseTo((point.y - before.y) / before.scale)
  })

  it('缩放范围 10%–800%', () => {
    const image = { width: 100, height: 100 }
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 100, { x: 0, y: 0 }, image, viewport).scale).toBe(MAX_SCALE)
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.001, { x: 0, y: 0 }, image, viewport).scale).toBe(MIN_SCALE)
  })

  it('平移：图比视口小的方向居中，大的方向边不进视口', () => {
    const image = { width: 1000, height: 300 }
    // 宽 1000 > 800：最多偏 100；高 300 < 600：居中
    expect(clampPan({ scale: 1, x: 500, y: 200 }, image, viewport)).toEqual({ scale: 1, x: 100, y: 0 })
    expect(clampPan({ scale: 1, x: -500, y: 0 }, image, viewport)).toEqual({ scale: 1, x: -100, y: 0 })
  })

  it('滚轮：向上放大、向下缩小，单次幅度有上限', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
    expect(wheelFactor(-10000)).toBe(wheelFactor(-100))
  })
})
