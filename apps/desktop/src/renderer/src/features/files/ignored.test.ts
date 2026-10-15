import { describe, expect, it } from 'vitest'
import { hideIgnoredKey, isHidingIgnored, isIgnoredPath, partitionIgnored, splitStatuses } from './ignored'

describe('splitStatuses', () => {
  it('被忽略的单独成集合，不混进改动', () => {
    const { changes, ignored } = splitStatuses({ 'a.ts': 'M', build: 'I', 'x/y.log': 'I', n: '?' })
    expect(changes).toEqual({ 'a.ts': 'M', n: '?' })
    expect([...ignored].sort()).toEqual(['build', 'x/y.log'])
  })
})

describe('isIgnoredPath', () => {
  const ignored = new Set(['build', 'deep/z.log', '::1/out'])
  it('自己或任一层上级被忽略', () => {
    expect(isIgnoredPath('build', ignored)).toBe(true)
    expect(isIgnoredPath('build/a/b.js', ignored)).toBe(true)
    expect(isIgnoredPath('deep/z.log', ignored)).toBe(true)
    expect(isIgnoredPath('deep/z.log2', ignored)).toBe(false)
    expect(isIgnoredPath('deep', ignored)).toBe(false)
    expect(isIgnoredPath('builder/x', ignored)).toBe(false)
  })
  it('附加文件夹的 ::N 前缀照常处理', () => {
    expect(isIgnoredPath('::1/out/a.js', ignored)).toBe(true)
    expect(isIgnoredPath('::1/src/a.js', ignored)).toBe(false)
    expect(isIgnoredPath('::2/out/a.js', ignored)).toBe(false)
  })
  it("'' 永远不算被忽略", () => {
    expect(isIgnoredPath('', new Set(['']))).toBe(false)
    expect(isIgnoredPath('', ignored)).toBe(false)
  })
})

describe('partitionIgnored', () => {
  it('稳定：不被忽略的在前，各自保持原顺序', () => {
    const items = ['b/1', 'a', 'b/2', 'c', 'b/3']
    expect(partitionIgnored(items, p => p, new Set(['b']))).toEqual(['a', 'c', 'b/1', 'b/2', 'b/3'])
  })
  it('没有被忽略的原样返回', () => {
    const items = ['a', 'b']
    expect(partitionIgnored(items, p => p, new Set())).toBe(items)
  })
})

describe('hideIgnoredKey', () => {
  it('斜杠统一、去结尾斜杠；Windows / macOS 转小写，Linux 保留大小写', () => {
    expect(hideIgnoredKey(['D:', 'Work', 'Proj', ''].join('\\'), 'win32')).toBe('d:/work/proj')
    expect(hideIgnoredKey('/Users/A/Proj/', 'darwin')).toBe('/users/a/proj')
    expect(hideIgnoredKey('/home/A/Proj/', 'linux')).toBe('/home/A/Proj')
  })
  it('null 根不隐藏', () => {
    expect(isHidingIgnored({ x: true }, null)).toBe(false)
  })
})
