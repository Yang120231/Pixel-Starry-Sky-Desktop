import { describe, expect, it } from 'vitest'
import { withOpen } from './panelOpen'

describe('右侧面板按对话记开合', () => {
  it('各对话互不影响；再记一次挪到最后', () => {
    let map = withOpen({}, 'a', true)
    map = withOpen(map, 'b', false)
    map = withOpen(map, 'a', false)
    expect(map).toEqual({ b: false, a: false })
    expect(Object.keys(map)).toEqual(['b', 'a'])
  })

  it('超过 200 个丢最早的', () => {
    let map = {}
    for (let i = 0; i < 201; i++) map = withOpen(map, `s${i}`, true)
    expect(Object.keys(map)).toHaveLength(200)
    expect(map).not.toHaveProperty('s0')
    expect(map).toHaveProperty('s200', true)
  })
})
