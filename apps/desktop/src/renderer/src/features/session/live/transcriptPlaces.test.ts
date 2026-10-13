import { describe, expect, it } from 'vitest'
import {
  MAX_PLACES,
  forgetPlace,
  placeOf,
  registerTranscriptView,
  restoredHidden,
  savePlace,
  transcriptViewStats,
} from './transcriptPlaces'

const place = (hidden: number) => ({ hidden, atBottom: true, anchor: null, scrollTop: 0 })

describe('对话位置的保存', () => {
  it('存取和删除', () => {
    savePlace('s1', place(5))
    expect(placeOf('s1')?.hidden).toBe(5)
    expect(placeOf(null)).toBeNull()
    forgetPlace('s1')
    expect(placeOf('s1')).toBeNull()
  })

  it('最多 100 个，最久没动的先丢；再存一次算最近', () => {
    for (let i = 0; i < MAX_PLACES; i++) savePlace(`p${i}`, place(i))
    savePlace('p0', place(1))
    savePlace('extra', place(2))
    expect(placeOf('p0')).not.toBeNull()
    expect(placeOf('p1')).toBeNull()
    expect(placeOf('extra')).not.toBeNull()
    for (let i = 0; i < MAX_PLACES; i++) forgetPlace(`p${i}`)
    forgetPlace('extra')
  })
})

describe('重新挂载时隐藏几轮', () => {
  it('有保存的就用它，已经显示的不再藏回去', () => {
    expect(restoredHidden(40, 100, 20, false)).toBe(40)
    expect(restoredHidden(null, 100, 20, false)).toBe(100)
  })

  it('设置为「全部」时不隐藏', () => {
    expect(restoredHidden(40, 0, null, false)).toBe(0)
    expect(restoredHidden(null, 0, null, false)).toBe(0)
  })

  it('轻量模式下至少隐藏到只显示设置的轮数', () => {
    expect(restoredHidden(40, 100, 20, true)).toBe(100)
    expect(restoredHidden(120, 100, 20, true)).toBe(120)
  })
})

describe('遥测登记', () => {
  it('统计挂着的对话流个数和显示轮数的最大值', () => {
    const base = transcriptViewStats()
    const a = registerTranscriptView(() => 20)
    const b = registerTranscriptView(() => 45)
    expect(transcriptViewStats()).toEqual({ sessionViews: base.sessionViews + 2, shownTurnsMax: 45 })
    a()
    b()
    expect(transcriptViewStats().sessionViews).toBe(base.sessionViews)
  })
})
