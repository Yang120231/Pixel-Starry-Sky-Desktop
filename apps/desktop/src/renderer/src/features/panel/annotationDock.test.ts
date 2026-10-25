import { describe, expect, it } from 'vitest'
import { DEFAULT_DOCK_PREFS, parseDockPrefs, placedDock } from './annotationDock'

describe('批注栏位置', () => {
  it('读存下的值：坏的、缺的用默认值，大小夹到范围里', () => {
    expect(parseDockPrefs(null)).toEqual(DEFAULT_DOCK_PREFS)
    expect(parseDockPrefs('不是 JSON')).toEqual(DEFAULT_DOCK_PREFS)
    expect(parseDockPrefs('{"dock":"middle","side":"wide","folded":1}')).toEqual(DEFAULT_DOCK_PREFS)
    expect(parseDockPrefs('{"dock":"top","side":9999,"band":10,"folded":true}')).toEqual({
      dock: 'top',
      side: 420,
      band: 140,
      folded: true,
    })
  })

  it('选了左右、面板太窄时暂时放下面；上下不变', () => {
    expect(placedDock('right', false)).toBe('bottom')
    expect(placedDock('left', false)).toBe('bottom')
    expect(placedDock('right', true)).toBe('right')
    expect(placedDock('top', false)).toBe('top')
  })
})
