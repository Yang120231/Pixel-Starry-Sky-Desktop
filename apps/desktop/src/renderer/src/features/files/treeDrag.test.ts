import { describe, expect, it } from 'vitest'
import {
  cutPasteKeys,
  dropFolder,
  dropTarget,
  movedPath,
  type CutPasteOps,
  type DragOver,
  type DragSource,
} from './treeDrag'

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

describe('dropFolder（从系统拖进来时用）', () => {
  it('项目名行是根目录，文件夹行是它自己，文件行是它所在的文件夹，链接文件夹不能放', () => {
    expect(dropFolder({ ref, kind: 'root' })).toBe('')
    expect(dropFolder({ ref, kind: 'directory', path: 'src/lib' })).toBe('src/lib')
    expect(dropFolder({ ref, kind: 'file', path: 'src/a.ts' })).toBe('src')
    expect(dropFolder({ ref, kind: 'file', path: 'a.ts' })).toBe('')
    expect(dropFolder({ ref, kind: 'directory', path: 'link', linked: true })).toBeNull()
  })
})

describe('movedPath', () => {
  it('拼出新路径', () => {
    expect(movedPath(file('a/b.md'), 'docs')).toBe('docs/b.md')
    expect(movedPath(dir('a/src'), '')).toBe('src')
  })
})

describe('cutPasteKeys', () => {
  const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => {
    const e = {
      key: k,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
      shiftKey: !!mods.shift,
      altKey: false,
      prevented: false,
      preventDefault() {
        e.prevented = true
      },
      stopPropagation() {},
    }
    return e
  }
  const ops = (cut: DragSource | null = null) => {
    const calls: { cut: (DragSource | null)[]; paste: DragOver[] } = { cut: [], paste: [] }
    const value: CutPasteOps = { cut, setCut: s => calls.cut.push(s), paste: o => calls.paste.push(o) }
    return { value, calls }
  }

  it('Ctrl+X / ⌘X 剪切这一行；项目名行（没有 source）不剪切', () => {
    const o = ops()
    const e = key('x', { ctrl: true })
    cutPasteKeys(e, o.value, file('a.ts'), onFile('a.ts'))
    cutPasteKeys(key('X', { meta: true }), o.value, dir('src'), onDir('src'))
    cutPasteKeys(key('x', { ctrl: true }), o.value, null, { ref, kind: 'root' })
    expect(o.calls.cut.map(c => c?.path)).toEqual(['a.ts', 'src'])
    expect(e.prevented).toBe(true)
  })

  it('Ctrl+V 只在剪切过、这一行能放时粘贴；没剪切时不拦（交给别的处理）', () => {
    const none = ops()
    const e = key('v', { ctrl: true })
    cutPasteKeys(e, none.value, file('a.ts'), onFile('a.ts'))
    expect(none.calls.paste).toEqual([])
    expect(e.prevented).toBe(false)
    const some = ops(file('a.ts'))
    cutPasteKeys(key('v', { ctrl: true }), some.value, dir('src'), onDir('src'))
    cutPasteKeys(key('v', { ctrl: true }), some.value, file('x.ts'), null)
    expect(some.calls.paste).toEqual([onDir('src')])
  })

  it('Esc 取消剪切；带 Shift 的组合键不算', () => {
    const o = ops(file('a.ts'))
    cutPasteKeys(key('Escape'), o.value, null, null)
    cutPasteKeys(key('x', { ctrl: true, shift: true }), o.value, file('b.ts'), onFile('b.ts'))
    expect(o.calls.cut).toEqual([null])
  })
})
