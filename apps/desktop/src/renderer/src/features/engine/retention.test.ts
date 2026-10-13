import { describe, expect, it } from 'vitest'
import { evictions, RETAIN_RELEASED } from './retention'

const input = (over: Partial<Parameters<typeof evictions>[0]> = {}) => ({
  loaded: [] as string[],
  refs: new Map<string, number>(),
  released: [] as string[],
  pinned: new Set<string>(),
  archived: new Set<string>(),
  keep: RETAIN_RELEASED,
  ...over,
})

describe('快照释放', () => {
  it('引用归零的只留最近 3 个，其余按先后释放', () => {
    const released = ['a', 'b', 'c', 'd', 'e']
    expect(evictions(input({ loaded: released, released }))).toEqual(['a', 'b'])
  })

  it('还有引用的不释放也不占名额', () => {
    const released = ['a', 'b', 'c', 'd']
    expect(evictions(input({ loaded: [...released, 'x'], released, refs: new Map([['x', 2]]) }))).toEqual(['a'])
    expect(evictions(input({ loaded: released, released, refs: new Map([['a', 1]]) }))).toEqual([])
  })

  it('运行中 / 等你处理 / 正在打开的不释放也不占名额', () => {
    const released = ['a', 'b', 'c', 'd', 'e']
    expect(evictions(input({ loaded: released, released, pinned: new Set(['a', 'b', 'c']) }))).toEqual([])
    expect(evictions(input({ loaded: released, released, pinned: new Set(['e']) }))).toEqual(['a'])
  })

  it('归档且没人用的直接释放，不占名额', () => {
    const released = ['a', 'b', 'c', 'd']
    expect(evictions(input({ loaded: released, released, archived: new Set(['d']) }))).toEqual(['d'])
    // 归档但还在用 / 还在跑的留着
    expect(evictions(input({ loaded: ['d'], released, archived: new Set(['d']), refs: new Map([['d', 1]]) }))).toEqual(
      [],
    )
    expect(evictions(input({ loaded: ['d'], released, archived: new Set(['d']), pinned: new Set(['d']) }))).toEqual([])
  })

  it('没有释放记录的（后台预读）最先释放', () => {
    expect(evictions(input({ loaded: ['p', 'a', 'b', 'c'], released: ['a', 'b', 'c'] }))).toEqual(['p'])
  })

  it('keep 为 0 时全部释放', () => {
    expect(evictions(input({ loaded: ['a', 'b'], released: ['a', 'b'], keep: 0 }))).toEqual(['a', 'b'])
  })
})
