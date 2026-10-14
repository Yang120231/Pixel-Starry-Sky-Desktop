import { describe, expect, it } from 'vitest'
import { dropTarget, movedPath, type DragSource } from './treeDrag'

const ref = { projectId: 'p1' }
const file = (path: string): DragSource => ({ ref, path, kind: 'file', name: path.split('/').pop()! })
const dir = (path: string): DragSource => ({ ref, path, kind: 'directory', name: path.split('/').pop()! })
const onDir = (path: string, linked = false) => ({ ref, kind: 'directory' as const, path, linked })
const onFile = (path: string) => ({ ref, kind: 'file' as const, path })

describe('dropTarget', () => {
  it('文件夹行：放进这个文件夹', () => {
    expect(dropTarget(file('a.md'), onDir('docs'))).toEqual({ folder: 'docs' })
    expect(dropTarget(dir('src/lib'), onDir('docs'))).toEqual({ folder: 'docs' })
  })
  it('文件行：放进它的上级文件夹', () => {
    expect(dropTarget(file('a.md'), onFile('docs/b.md'))).toEqual({ folder: 'docs' })
  })
  it('项目名行：根目录', () => {
    expect(dropTarget(file('docs/a.md'), { ref, kind: 'root' })).toEqual({ folder: '' })
  })
  it('放回原来的文件夹是 null', () => {
    expect(dropTarget(file('docs/a.md'), onDir('docs'))).toBeNull()
    expect(dropTarget(file('docs/a.md'), onFile('docs/b.md'))).toBeNull()
    expect(dropTarget(file('a.md'), { ref, kind: 'root' })).toBeNull()
    expect(dropTarget(file('a.md'), onFile('b.md'))).toBeNull()
  })
  it('文件夹不能放进自己或子孙', () => {
    expect(dropTarget(dir('src'), onDir('src'))).toBeNull()
    expect(dropTarget(dir('src'), onDir('src/inner'))).toBeNull()
    expect(dropTarget(dir('src'), onFile('src/inner/a.ts'))).toBeNull()
  })
  it('src 和 src2 不是父子', () => {
    expect(dropTarget(dir('src'), onDir('src2'))).toEqual({ folder: 'src2' })
    expect(dropTarget(dir('src2'), onDir('src'))).toEqual({ folder: 'src' })
  })
  it('跨项目是 null', () => {
    expect(dropTarget(file('a.md'), { ref: { projectId: 'p2' }, kind: 'directory', path: 'docs' })).toBeNull()
    expect(dropTarget(file('a.md'), { ref: { sessionId: 's1' }, kind: 'root' })).toBeNull()
  })
  it('链接文件夹是 null', () => {
    expect(dropTarget(file('a.md'), onDir('linked', true))).toBeNull()
  })
})

describe('movedPath', () => {
  it('拼出新路径', () => {
    expect(movedPath(file('a/b.md'), 'docs')).toBe('docs/b.md')
    expect(movedPath(dir('a/src'), '')).toBe('src')
  })
})
