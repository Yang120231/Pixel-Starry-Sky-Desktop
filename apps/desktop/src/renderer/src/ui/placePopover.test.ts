import { describe, expect, it } from 'vitest'
import { placePopover } from './placePopover'

const vp = { width: 1000, height: 800 }
const rect = (left: number, top: number, w = 80, h = 28) => ({ left, top, right: left + w, bottom: top + h })

describe('placePopover', () => {
  it('默认放在锚点下方、左对齐，留 4px 间隙', () => {
    const p = placePopover(rect(100, 100), { width: 200, height: 150 }, vp)
    expect(p).toMatchObject({ side: 'bottom', left: 100, top: 132 })
  })

  it('下面放不下且上面更宽裕时翻到上方', () => {
    const p = placePopover(rect(100, 700), { width: 200, height: 300 }, vp)
    expect(p.side).toBe('top')
    expect(p.top).toBe(700 - 4 - 300)
  })

  it('两边都放不下时留在宽裕的一边并限制 maxHeight', () => {
    const p = placePopover(rect(100, 150), { width: 200, height: 900 }, vp)
    expect(p.side).toBe('bottom')
    expect(p.maxHeight).toBe(800 - 178 - 4 - 8)
  })

  it('不需要翻时保持首选方向（side=top 够高）', () => {
    const p = placePopover(rect(100, 500), { width: 200, height: 100 }, vp, { side: 'top', offset: 8 })
    expect(p).toMatchObject({ side: 'top', top: 500 - 8 - 100 })
  })

  it('align end 右边对齐锚点', () => {
    const p = placePopover(rect(500, 100), { width: 200, height: 100 }, vp, { align: 'end' })
    expect(p.left).toBe(580 - 200)
  })

  it('横向夹在视口内，留 8px', () => {
    expect(placePopover(rect(950, 100), { width: 200, height: 100 }, vp).left).toBe(1000 - 200 - 8)
    expect(placePopover(rect(10, 100), { width: 200, height: 100 }, vp, { align: 'end' }).left).toBe(8)
  })

  it('side=right 放在右边，放不下翻到左边', () => {
    expect(placePopover(rect(100, 100), { width: 200, height: 100 }, vp, { side: 'right', offset: 8 })).toMatchObject({
      side: 'right',
      left: 188,
    })
    const flipped = placePopover(rect(850, 100), { width: 200, height: 100 }, vp, { side: 'right', offset: 8 })
    expect(flipped).toMatchObject({ side: 'left', left: 850 - 8 - 200 })
  })

  it('左右放置时纵向对齐并夹在视口内', () => {
    const p = placePopover(rect(100, 760), { width: 200, height: 300 }, vp, { side: 'right', align: 'start' })
    expect(p.top).toBe(800 - 300 - 8)
    const end = placePopover(rect(100, 20), { width: 200, height: 300 }, vp, { side: 'right', align: 'end' })
    expect(end.top).toBe(8)
  })
})
