// 用量图表的曲线、横轴刻度、柱子位置（docs/ui/usage-chart-style.md §8）
import { describe, expect, it } from 'vitest'
import { axisTicks, barGeometry, monotoneSegments, segmentsPath, type Point } from './chartGeometry'

/** 三次贝塞尔上取点 */
const at = (s: ReturnType<typeof monotoneSegments>[number], t: number): Point => {
  const u = 1 - t
  const mix = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
  return { x: mix(s.from.x, s.c1.x, s.c2.x, s.to.x), y: mix(s.from.y, s.c1.y, s.c2.y, s.to.y) }
}

describe('单调曲线', () => {
  // SVG 里 y 向下：值越大 y 越小；140 是底边（0）
  const points: Point[] = [0, 0, 0, 120, 6, 0, 80, 75, 140].map((v, i) => ({ x: i * 50, y: 140 - v }))
  const segments = monotoneSegments(points)

  it('经过每个点', () => {
    expect(segments).toHaveLength(points.length - 1)
    segments.forEach((s, i) => {
      expect(s.from).toEqual(points[i])
      expect(s.to).toEqual(points[i + 1])
    })
  })

  it('两点之间不冲过这两点：不会画到 0 以下、不会把峰值画高，平的一段保持平', () => {
    segments.forEach(s => {
      const lo = Math.min(s.from.y, s.to.y),
        hi = Math.max(s.from.y, s.to.y)
      for (let t = 0; t <= 1; t += 0.05) {
        const p = at(s, t)
        expect(p.y).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(p.y).toBeLessThanOrEqual(hi + 1e-6)
      }
    })
    // 前三个 0：中间一段完全贴着底边
    expect(segments[0].c1.y).toBe(140)
    expect(segments[1].c2.y).toBe(140)
  })

  it('横坐标也单调：曲线不会往回拐', () => {
    segments.forEach(s => {
      expect(s.c1.x).toBeGreaterThan(s.from.x)
      expect(s.c2.x).toBeLessThan(s.to.x)
    })
  })

  it('不到两个点不画；路径以 M 开头、每段一个 C', () => {
    expect(monotoneSegments([{ x: 0, y: 0 }])).toEqual([])
    expect(segmentsPath([])).toBe('')
    const d = segmentsPath(segments)
    expect(d.startsWith('M0.0,140.0C')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(points.length - 1)
  })
})

describe('横轴刻度', () => {
  it('从最后一格往前等距标，标签之间至少 72px；最左边离得够远时也标', () => {
    // 30 天、600px：每格 20px → 每 5 天
    expect(axisTicks(30, 600, 'day')).toEqual([0, 4, 9, 14, 19, 24, 29])
    // 7 天、600px：每天
    expect(axisTicks(7, 600, 'day')).toEqual([0, 1, 2, 3, 4, 5, 6])
    // 今天 24 小时、600px：每 3 小时
    expect(axisTicks(24, 600, 'hour')).toEqual([2, 5, 8, 11, 14, 17, 20, 23])
    // 90 天、600px：每 14 天（第一个离左边只有 33px，起始日期不标）
    expect(axisTicks(90, 600, 'day')).toEqual([5, 19, 33, 47, 61, 75, 89])
  })

  it('最左边离下一个标签太近时不标，免得挤在一起', () => {
    const ticks = axisTicks(24, 600, 'hour')
    expect(ticks[0]).toBe(2)
    expect(axisTicks(1, 600, 'day')).toEqual([0])
    expect(axisTicks(0, 600, 'day')).toEqual([])
  })
})

describe('柱子位置', () => {
  it('柱间留柱宽约 15%，至少 1px；太宽时最多 36px、在格子里居中', () => {
    expect(barGeometry(30, 600)).toEqual({ slot: 20, bar: 17, offset: 1.5 })
    const wide = barGeometry(7, 600)
    expect(wide.bar).toBe(36)
    expect(wide.offset).toBeCloseTo((600 / 7 - 36) / 2)
    expect(barGeometry(90, 300).bar).toBeCloseTo(300 / 90 - 1)
  })
})
