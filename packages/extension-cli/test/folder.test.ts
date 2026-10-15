import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { folderPackFiles, walkPack } from '../src/lib/folder'

const made: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pxext-folder-'))
  made.push(dir)
  return dir
}
function put(root: string, rel: string, text = 'x'): void {
  const file = join(root, rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

const BIG = { limitFiles: 1000, limitBytes: 1e9 }
const paths = (r: { entries: { path: string }[] }): string[] => r.entries.map(e => e.path)

describe('walkPack', () => {
  it('lists files with sizes, sorted by full path in UTF-16 order', async () => {
    const root = tempDir()
    put(root, 'b.txt', '12')
    put(root, 'a/z.txt', '1')
    put(root, 'a.b', '123')
    put(root, 'Z.txt')
    const r = await walkPack(root, BIG)
    expect(r.truncated).toBe(false)
    expect(paths(r)).toEqual(['Z.txt', 'a.b', 'a/z.txt', 'b.txt'])
    expect(r.entries.find(e => e.path === 'a.b')).toEqual({ path: 'a.b', size: 3, kind: 'file' })
  })

  it('applies the skip list and records the outermost skipped items', async () => {
    const root = tempDir()
    put(root, 'pixelsky-extension.json', '{}')
    put(root, '.git/config')
    put(root, '.git/objects/aa/bb')
    put(root, 'node_modules/x/index.js')
    put(root, '__MACOSX/a')
    put(root, 'sub/node_modules/y.js')
    put(root, '.gitignore')
    put(root, '.src/build.js')
    put(root, '.DS_Store')
    put(root, 'samples/.hidden.txt')
    put(root, 'samples/Thumbs.db')
    put(root, 'release.zip')
    put(root, 'tool.VSIX')
    put(root, 'sub/inner.zip')
    const r = await walkPack(root, BIG)
    expect(paths(r)).toEqual(['pixelsky-extension.json', 'samples/.hidden.txt', 'sub/inner.zip'])
    expect(r.skipped.sort()).toEqual(
      [
        '.DS_Store',
        '.git/',
        '.gitignore',
        '.src/',
        '__MACOSX/',
        'node_modules/',
        'release.zip',
        'samples/Thumbs.db',
        'sub/node_modules/',
        'tool.VSIX',
      ].sort(),
    )
  })

  it('stops at the file limit and flags truncated', async () => {
    const root = tempDir()
    for (const n of ['a', 'b', 'c', 'd']) put(root, n)
    const r = await walkPack(root, { limitFiles: 2, limitBytes: 1e9 })
    expect(r.truncated).toBe(true)
    expect(paths(r)).toEqual(['a', 'b'])
  })

  it('adds the size before comparing with the byte limit', async () => {
    const root = tempDir()
    put(root, 'a', '1234')
    put(root, 'b', '1234')
    const r = await walkPack(root, { limitFiles: 10, limitBytes: 7 })
    expect(r.truncated).toBe(true)
    expect(paths(r)).toEqual(['a'])
    const ok = await walkPack(root, { limitFiles: 10, limitBytes: 8 })
    expect(ok.truncated).toBe(false)
    expect(ok.entries).toHaveLength(2)
  })

  it('returns an empty result for a missing root', async () => {
    const r = await walkPack(join(tempDir(), 'nope'), BIG)
    expect(r).toEqual({ entries: [], truncated: false, skipped: [] })
  })

  it('records symlinks as kind symlink without following them', async () => {
    const root = tempDir()
    const outside = tempDir()
    put(outside, 'secret.txt')
    put(root, 'real.txt')
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'), 'file')
      symlinkSync(outside, join(root, 'linkdir'), 'junction')
    } catch {
      return // 没有创建符号链接的权限（Windows 非开发者模式）
    }
    const r = await walkPack(root, BIG)
    expect(r.entries.filter(e => e.kind === 'symlink').map(e => e.path)).toEqual(['link.txt', 'linkdir'])
    expect(paths(r)).not.toContain('linkdir/secret.txt')
  })
})

describe('folderPackFiles', () => {
  it('stat and read cover regular files only', async () => {
    const root = tempDir()
    put(root, 'a/b.txt', 'hello')
    const f = await folderPackFiles(root)
    expect(f.stat('a/b.txt')).toBe(5)
    expect(f.stat('a')).toBeNull()
    expect(f.stat('missing')).toBeNull()
    expect(new TextDecoder().decode(f.read('a/b.txt', 100)!)).toBe('hello')
    expect(f.read('a', 100)).toBeNull()
    expect(f.read('missing', 100)).toBeNull()
  })

  it('read returns at most maxBytes', async () => {
    const root = tempDir()
    put(root, 'big.txt', 'abcdefghij')
    const f = await folderPackFiles(root)
    expect(new TextDecoder().decode(f.read('big.txt', 4)!)).toBe('abcd')
    expect(f.read('big.txt', 0)!.length).toBe(0)
    expect(f.read('big.txt', 1000)!.length).toBe(10)
  })

  it('treats a symlink as missing', async () => {
    const root = tempDir()
    const outside = tempDir()
    put(outside, 'secret.txt', 'secret')
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'pixelsky-extension.json'), 'file')
    } catch {
      return
    }
    const f = await folderPackFiles(root)
    expect(f.stat('pixelsky-extension.json')).toBeNull()
    expect(f.read('pixelsky-extension.json', 100)).toBeNull()
    expect(f.entries).toEqual([{ path: 'pixelsky-extension.json', size: 0, kind: 'symlink' }])
  })

  it('rejects unsafe paths', async () => {
    const root = tempDir()
    const outer = join(root, 'pack')
    put(root, 'outside.txt', 'o')
    put(outer, 'in.txt', 'i')
    const f = await folderPackFiles(outer)
    expect(f.read('in.txt', 10)).not.toBeNull()
    for (const bad of [
      '../outside.txt',
      'a/../../outside.txt',
      'a/../in.txt',
      './in.txt',
      'a//b',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'C:in.txt',
      'sub\\in.txt',
      'in.txt\0',
      '',
      join(root, 'outside.txt'),
    ]) {
      expect(f.stat(bad), bad).toBeNull()
      expect(f.read(bad, 10), bad).toBeNull()
    }
  })

  it('passes the skipped list through and honours the limits', async () => {
    const root = tempDir()
    put(root, '.git/x')
    put(root, 'a')
    put(root, 'b')
    const f = await folderPackFiles(root, { limitFiles: 1, limitBytes: 1e9 })
    expect(f.skipped).toEqual(['.git/'])
    expect(f.truncated).toBe(true)
    expect(f.entries.map(e => e.path)).toEqual(['a'])
  })

  it('stat / read are case-exact on every platform', async () => {
    const root = tempDir()
    put(root, 'Pixelsky-Extension.json', '{}')
    const f = await folderPackFiles(root)
    expect(f.stat('Pixelsky-Extension.json')).toBe(2)
    expect(f.stat('pixelsky-extension.json')).toBeNull()
    expect(f.read('pixelsky-extension.json', 100)).toBeNull()
  })

  it('does not throw for a missing root', async () => {
    const f = await folderPackFiles(join(tempDir(), 'nope'))
    expect(f.entries).toEqual([])
    expect(f.stat('a')).toBeNull()
  })
})
