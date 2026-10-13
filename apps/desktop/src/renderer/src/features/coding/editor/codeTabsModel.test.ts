import { describe, expect, it } from 'vitest'
import { closeInGroup, cycleInGroup, lruToRelease, openInGroup, parseCodeTabs, pathKey } from './codeTabsModel'

const g = (tabs: string[], active: string | null) => ({ tabs, active })

describe('parseCodeTabs', () => {
  it('丢掉坏数据', () => {
    expect(parseCodeTabs(null)).toEqual({})
    expect(parseCodeTabs([])).toEqual({})
    expect(parseCodeTabs({ a: 1, b: { tabs: 'x' }, c: { tabs: [] } })).toEqual({})
  })
  it('只留 file: 标签并去重，active 不在列表里时取第一个', () => {
    expect(parseCodeTabs({ p: { tabs: ['file:a', 'x', 'file:a', 'file:b', 3], active: 'file:zzz' } })).toEqual({
      p: g(['file:a', 'file:b'], 'file:a'),
    })
    expect(parseCodeTabs({ p: { tabs: ['file:a', 'file:b'], active: 'file:b' } }).p).toEqual(
      g(['file:a', 'file:b'], 'file:b'),
    )
  })
})

describe('openInGroup', () => {
  it('已有就激活', () => {
    expect(openInGroup(g(['a', 'b'], 'a'), 'b')).toEqual(g(['a', 'b'], 'b'))
  })
  it('新的插到当前标签右边', () => {
    expect(openInGroup(g(['a', 'b', 'c'], 'a'), 'x')).toEqual(g(['a', 'x', 'b', 'c'], 'x'))
  })
  it('没有当前标签时放最后', () => {
    expect(openInGroup(g(['a'], null), 'x')).toEqual(g(['a', 'x'], 'x'))
    expect(openInGroup(g([], null), 'x')).toEqual(g(['x'], 'x'))
  })
})

describe('closeInGroup', () => {
  it('关当前标签激活右边那个', () => {
    expect(closeInGroup(g(['a', 'b', 'c'], 'b'), 'b')).toEqual(g(['a', 'c'], 'c'))
  })
  it('右边没有就激活左边', () => {
    expect(closeInGroup(g(['a', 'b'], 'b'), 'b')).toEqual(g(['a'], 'a'))
    expect(closeInGroup(g(['a'], 'a'), 'a')).toEqual(g([], null))
  })
  it('关别的标签不改当前标签', () => {
    expect(closeInGroup(g(['a', 'b', 'c'], 'a'), 'c')).toEqual(g(['a', 'b'], 'a'))
  })
  it('不存在的 id 原样返回', () => {
    const group = g(['a'], 'a')
    expect(closeInGroup(group, 'zz')).toBe(group)
  })
})

describe('cycleInGroup', () => {
  it('绕回另一头', () => {
    expect(cycleInGroup(g(['a', 'b', 'c'], 'c'), 1).active).toBe('a')
    expect(cycleInGroup(g(['a', 'b', 'c'], 'a'), -1).active).toBe('c')
    expect(cycleInGroup(g(['a', 'b', 'c'], 'a'), 1).active).toBe('b')
  })
  it('少于两个标签不动', () => {
    const group = g(['a'], 'a')
    expect(cycleInGroup(group, 1)).toBe(group)
  })
})

describe('lruToRelease', () => {
  it('没超上限不释放', () => {
    expect(lruToRelease(['a', 'b'], 'b', new Set(), 2)).toEqual([])
  })
  it('最久的先释放，跳过当前和未保存的', () => {
    expect(lruToRelease(['a', 'b', 'c', 'd', 'e'], 'e', new Set(['a']), 3)).toEqual(['b', 'c'])
  })
  it('能释放的不够时只释放能释放的', () => {
    expect(lruToRelease(['a', 'b', 'c'], 'c', new Set(['a', 'b']), 1)).toEqual([])
  })
})

describe('pathKey', () => {
  it('统一分隔符和大小写', () => {
    expect(pathKey('.\\src\\A.ts', true)).toBe('src/a.ts')
    expect(pathKey('src/A.ts', false)).toBe('src/A.ts')
  })
})
