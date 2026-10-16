import { describe, expect, it } from 'vitest'
import { fakePack, fakeState } from '@/features/extpacks/testing'
import { editorThemeOptions, editorThemesAvailable } from './store'

describe('editorThemeOptions', () => {
  const pack = fakePack({
    id: 'p.one',
    contributes: {
      themes: [
        { id: 'night', label: { zh: '夜', en: 'Night' }, uiTheme: 'dark', path: 'a.json' },
        { id: 'day', label: 'Day', uiTheme: 'light', path: 'b.json' },
      ],
    },
  })
  it('filters by ui mode and localizes labels', () => {
    expect(editorThemeOptions(fakeState(pack), 'dark', 'en-US')).toEqual([{ value: 'p.one/night', label: 'Night' }])
    expect(editorThemeOptions(fakeState(pack), 'light', 'zh-CN')).toEqual([{ value: 'p.one/day', label: 'Day' }])
  })
  it('skips packs that are not live', () => {
    expect(editorThemeOptions(fakeState({ ...pack, live: false }), 'dark', 'en-US')).toEqual([])
  })
  it('没有启用着的代码配色扩展就不显示这一行', () => {
    expect(editorThemesAvailable(fakeState(pack))).toBe(true)
    expect(editorThemesAvailable(fakeState({ ...pack, live: false }))).toBe(false)
    expect(editorThemesAvailable(fakeState({ ...pack, inactive: { themes: [0, 1] } }))).toBe(false)
    expect(editorThemesAvailable(fakeState())).toBe(false)
  })
})
