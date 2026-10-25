import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTmp, removeTmp } from './helpers/tmp'

// 像 Electron 44 带的 Node 24.21：目录里有只读文件时 rmSync 整个失败、报 EPERM，一个都不删
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const readOnly = (p: string): boolean => {
    const st = fs.lstatSync(p, { throwIfNoEntry: false })
    if (!st || st.isSymbolicLink()) return false
    if (st.isDirectory()) return fs.readdirSync(p).some(name => readOnly(join(p, name)))
    return !(st.mode & 0o200)
  }
  return {
    ...fs,
    rmSync: (p: string, opts?: import('node:fs').RmOptions) => {
      if (opts?.recursive && readOnly(p))
        throw Object.assign(new Error(`EPERM, Permission denied: ${p}`), { code: 'EPERM' })
      fs.rmSync(p, opts)
    },
  }
})

const { removeTree } = await import('../src/exec')

let root: string
beforeEach(() => {
  root = makeTmp('remove-tree')
})
afterEach(() => removeTmp(root))

describe('removeTree', () => {
  it('里面有只读文件（git 对象）也删得掉；不存在不报错', () => {
    const dir = join(root, 'session')
    const obj = join(dir, 'checkpoints', 'objects', 'ab', 'cdef')
    mkdirSync(join(obj, '..'), { recursive: true })
    writeFileSync(obj, 'x')
    chmodSync(obj, 0o444)
    writeFileSync(join(dir, 'items.jsonl'), 'x')
    removeTree(dir)
    expect(existsSync(dir)).toBe(false)
    expect(() => removeTree(dir)).not.toThrow()
  })

  it('不跟进符号链接 / 目录联接：链接外面的只读文件不改', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const kept = join(outside, 'keep')
    writeFileSync(kept, 'x')
    chmodSync(kept, 0o444)
    const dir = join(root, 'session')
    mkdirSync(dir)
    symlinkSync(outside, join(dir, 'link'), 'junction')
    const ro = join(dir, 'ro')
    writeFileSync(ro, 'x')
    chmodSync(ro, 0o444)
    removeTree(dir)
    expect(existsSync(dir)).toBe(false)
    expect(readdirSync(outside)).toEqual(['keep'])
    expect(lstatSync(kept).mode & 0o200).toBe(0)
    chmodSync(kept, 0o666)
  })
})
