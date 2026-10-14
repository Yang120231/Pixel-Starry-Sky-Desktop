import { describe, expect, it } from 'vitest'
import type { ProjectRecord } from '@pixelsky/protocol'
import { addedSummary, defaultPicked } from './projectImportModel'

const project = (name: string): ProjectRecord => ({ id: name, name, path: `D:/${name}`, addedAt: 1 })

describe('addedSummary', () => {
  it('只加了一个新项目：不提示', () => {
    expect(addedSummary({ added: [project('a')], existing: [], failed: [] })).toBeNull()
    expect(addedSummary({ added: [], existing: [], failed: [] })).toBeNull()
  })
  it('加了几个、几个已在、几个加不上', () => {
    expect(
      addedSummary({
        added: [project('a'), project('b'), project('c')],
        existing: [project('d')],
        failed: [{ path: 'D:/x/', error: '目录不存在' }],
      }),
    ).toBe('已添加 3 个项目，1 个已在列表里，1 个加不上：x')
  })
  it('加不上的只写文件夹名（Windows 路径也一样）', () => {
    const failed = [{ path: 'D:\\work\\missing\\', error: '' }]
    expect(addedSummary({ added: [], existing: [], failed })).toBe('1 个加不上：missing')
  })
  it('只选了一个已经在列表里的：写名字', () => {
    expect(addedSummary({ added: [], existing: [project('a')], failed: [] })).toBe('「a」已在列表里')
  })
  it('加不上的超过 3 个只列 3 个名字', () => {
    const failed = ['a', 'b', 'c', 'd'].map(n => ({ path: `/x/${n}`, error: '' }))
    expect(addedSummary({ added: [], existing: [], failed })).toBe('4 个加不上：a、b、c、…')
  })
})

describe('defaultPicked', () => {
  it('只勾像项目、还没加的', () => {
    expect(
      defaultPicked([
        { path: 'a', project: true, added: false },
        { path: 'b', project: false, added: false },
        { path: 'c', project: true, added: true },
      ]),
    ).toEqual(['a'])
  })
})
