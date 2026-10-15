import { describe, expect, it } from 'vitest'
import { EMPTY_PACK_STATE } from './model'
import { contributionsOf, getPackState, onUiThemeChange, packAssetUrl, readPackJson, uiTheme } from './store'

// node 环境：没有 window / document，导入和调用都不能有副作用或抛错
describe('extpacks store（无 window）', () => {
  it('状态是空的', () => {
    expect(typeof window).toBe('undefined')
    expect(getPackState()).toBe(EMPTY_PACK_STATE)
    expect(contributionsOf('grammars')).toEqual([])
  })
  it('uiTheme 是 dark，订阅是空操作', () => {
    expect(uiTheme()).toBe('dark')
    expect(() => onUiThemeChange(() => {})()).not.toThrow()
  })
  it('读取被拒绝，资源地址照常拼', async () => {
    await expect(readPackJson('f-1', 'a.json')).rejects.toThrow()
    expect(packAssetUrl('f-1', 'a.svg')).toBe('pixelsky-ext://f-1/a.svg?v=0')
  })
})
