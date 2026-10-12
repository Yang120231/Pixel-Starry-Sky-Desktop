// exe 自带的版本信息（docs/ui/open-with.md）；和 PowerShell VersionInfo 的对照在 scratch 里做过（编辑器、IDE 全部一致）
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exeVersion, productVersion } from './exe-version'

describe('exe 版本', () => {
  it('版本块里取字符串的 ProductVersion；没有时用固定格式的', () => {
    const key = Buffer.from('ProductVersion\0', 'utf16le')
    const value = Buffer.from('3.3.99\0', 'utf16le')
    const head = Buffer.alloc(6)
    head.writeUInt16LE(6 + key.length + value.length, 0)
    head.writeUInt16LE(value.length / 2, 2)
    head.writeUInt16LE(1, 4)
    expect(productVersion(Buffer.concat([head, key, value]))).toBe('3.3.99')

    const fixed = Buffer.alloc(64)
    fixed.writeUInt32LE(0xfeef04bd, 40)
    fixed.writeUInt32LE((1 << 16) | 2, 40 + 16)
    fixed.writeUInt32LE((3 << 16) | 4, 40 + 20)
    expect(productVersion(fixed)).toBe('1.2.3.4')
    expect(productVersion(Buffer.alloc(32))).toBeUndefined()
  })

  it.runIf(process.platform === 'win32')('读真的 exe：node.exe 的版本和 process.versions.node 一样', async () => {
    expect(await exeVersion(process.execPath)).toBe(process.versions.node)
  })

  it('不是 exe、截断的、不存在的返回空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exe-version-'))
    try {
      writeFileSync(join(dir, 'text.exe'), 'MZ but not really a program')
      expect(await exeVersion(join(dir, 'text.exe'))).toBeUndefined()
      if (process.platform === 'win32') {
        writeFileSync(join(dir, 'cut.exe'), readFileSync(process.execPath).subarray(0, 4096))
        expect(await exeVersion(join(dir, 'cut.exe'))).toBeUndefined()
      }
      expect(await exeVersion(join(dir, 'missing.exe'))).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
