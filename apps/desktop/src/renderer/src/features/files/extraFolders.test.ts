import { describe, expect, it } from 'vitest'
import { relativeInFolders, splitExtra } from './extraFolderPaths'

describe('splitExtra', () => {
  it('「::N/…」拆成编号和相对路径；主文件夹的原样', () => {
    expect(splitExtra('::2/src/a.ts')).toEqual({ index: 2, prefix: '::2', rest: 'src/a.ts' })
    expect(splitExtra('::1')).toEqual({ index: 1, prefix: '::1', rest: '' })
    expect(splitExtra('src/a.ts')).toEqual({ index: null, prefix: '', rest: 'src/a.ts' })
  })
})

describe('relativeInFolders', () => {
  const target = { path: 'D:/work/app', folders: [{ path: 'D:/work/docs' }, { path: 'E:/shared' }] }
  it('主文件夹优先，其次按顺序找附加文件夹；Windows 不分大小写', () => {
    expect(relativeInFolders('D:/work/app/src/a.ts', target, true)).toBe('src/a.ts')
    expect(relativeInFolders('d:/WORK/docs/guide/x.md', target, true)).toBe('::1/guide/x.md')
    expect(relativeInFolders('E:/shared/y.ts', target, true)).toBe('::2/y.ts')
  })
  it('都不在、或就是文件夹本身：null', () => {
    expect(relativeInFolders('D:/other/z.ts', target, true)).toBeNull()
    expect(relativeInFolders('D:/work/docs', target, true)).toBeNull()
  })
})
