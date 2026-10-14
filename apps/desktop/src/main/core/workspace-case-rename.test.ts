// 区分大小写的文件系统（Linux、WSL、SSH 远端）上只改大小写的重命名：目标是另一个文件时要拒绝，不能覆盖
// （审查报告 2026-10-14）。Windows 上用 fsutil 把测试目录设成区分大小写来模拟
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorkspaceFiles } from './workspace-files'

let folder: string, root: string, service: WorkspaceFiles
const ref = { projectId: 'project' }

/** 建一个区分大小写的目录；做不到（macOS 默认、没有 fsutil 权限）时返回 false */
async function caseSensitiveDir(dir: string): Promise<boolean> {
  await mkdir(dir)
  if (process.platform === 'win32') {
    try {
      execFileSync('fsutil.exe', ['file', 'setCaseSensitiveInfo', dir, 'enable'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch {
      return false
    }
  }
  await writeFile(join(dir, 'probe'), '1')
  await writeFile(join(dir, 'PROBE'), '2')
  const distinct = lstatSync(join(dir, 'probe')).ino !== lstatSync(join(dir, 'PROBE')).ino
  await rm(join(dir, 'probe'), { force: true })
  await rm(join(dir, 'PROBE'), { force: true })
  return distinct
}

let sensitive = false
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  folder = await mkdtemp(join(scratch, 'case-rename-test-'))
  root = join(folder, 'project')
  sensitive = await caseSensitiveDir(root)
  service = new WorkspaceFiles(value => ({ ref: value, name: 'p', path: root }))
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('只改大小写的重命名', () => {
  it('区分大小写时目标是另一个文件：拒绝，不覆盖', async ctx => {
    if (!sensitive) return ctx.skip()
    await writeFile(join(root, 'a.ts'), 'small a')
    await writeFile(join(root, 'A.ts'), 'BIG A')
    await expect(service.rename(ref, 'a.ts', 'A.ts')).rejects.toThrow('files.exists')
    expect(await readFile(join(root, 'A.ts'), 'utf8')).toBe('BIG A')
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('small a')
  })
  it('只有这一个文件时照常改名', async () => {
    await writeFile(join(root, 'b.ts'), 'b')
    expect(await service.rename(ref, 'b.ts', 'B.ts')).toEqual({ path: 'B.ts' })
    expect(await readFile(join(root, 'B.ts'), 'utf8')).toBe('b')
  })
})
