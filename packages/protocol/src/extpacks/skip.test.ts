import { describe, expect, it } from 'vitest'
import { extPackSkipped } from './skip'

const skipped = (p: string, kind: 'dir' | 'file' | 'symlink' = 'file') => extPackSkipped(p, kind)

describe('extPackSkipped', () => {
  it('.git / node_modules / __MACOSX：任何深度，连同它下面的一切', () => {
    for (const p of [
      '.git',
      '.git/config',
      'a/.git/x',
      'node_modules',
      'node_modules/a/b.json',
      'a/b/node_modules/c',
      '__MACOSX',
      '__MACOSX/._a.json',
    ]) {
      expect(skipped(p), p).toBe(true)
    }
    expect(skipped('node_modules', 'dir')).toBe(true)
  })
  it('samples 里面的 node_modules / .git 也跳过', () => {
    expect(skipped('samples/node_modules/x.js')).toBe(true)
    expect(skipped('samples/.git/HEAD')).toBe(true)
  })
  it('.DS_Store / Thumbs.db / desktop.ini：大小写不分，任何深度，samples 里也一样', () => {
    for (const p of [
      '.DS_Store',
      'a/.ds_store',
      'Thumbs.db',
      'a/b/THUMBS.DB',
      'desktop.ini',
      'samples/Desktop.ini',
      'samples/.DS_Store',
    ]) {
      expect(skipped(p), p).toBe(true)
    }
  })
  it('不在 samples/ 下：任何点开头的段都跳过（包括点开头的文件夹）', () => {
    for (const p of [
      '.gitignore',
      '.env',
      '.vscode',
      '.vscode/settings.json',
      '.src/a.ts',
      'a/.hidden/x.json',
      'a/.x',
    ]) {
      expect(skipped(p), p).toBe(true)
    }
  })
  it('samples/ 下的点文件保留（.env 样例）', () => {
    expect(skipped('samples/.env')).toBe(false)
    expect(skipped('samples/sub/.env.local')).toBe(false)
  })
  it('只叫 samples 的文件不享受例外', () => {
    expect(skipped('.samples')).toBe(true)
    expect(skipped('samples')).toBe(false)
  })
  it('根目录的 *.zip / *.vsix 跳过，子目录里的不跳', () => {
    expect(skipped('pack.zip')).toBe(true)
    expect(skipped('PACK.VSIX')).toBe(true)
    expect(skipped('dist/pack.zip')).toBe(false)
    expect(skipped('samples/a.zip')).toBe(false)
  })
  it('普通文件不跳', () => {
    for (const p of [
      'pixelsky-extension.json',
      'README.md',
      'LICENSE',
      'syntaxes/a.tmLanguage.json',
      'samples/example.env',
      'git/a.json',
    ]) {
      expect(skipped(p), p).toBe(false)
    }
  })
  it('目录和符号链接规则相同', () => {
    expect(skipped('.cache', 'dir')).toBe(true)
    expect(skipped('link', 'symlink')).toBe(false)
    expect(skipped('.link', 'symlink')).toBe(true)
  })
})
