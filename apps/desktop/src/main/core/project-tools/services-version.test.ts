// 环境检测不能执行项目目录里的 npm.bat / node.bat（审查报告 2026-10-14 第 2 条）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { version } from './services'

// 设了这个变量时 cmd 不在当前目录找程序（Claude Code 的 shell 就设了），测试时去掉，按普通用户的环境跑
const saved = process.env.NoDefaultCurrentDirectoryInExePath
let folder: string, root: string, marker: string

beforeEach(async () => {
  delete process.env.NoDefaultCurrentDirectoryInExePath
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  folder = await mkdtemp(join(scratch, 'tool-version-test-'))
  root = join(folder, 'project')
  marker = join(folder, 'ran.txt')
  await mkdir(root)
  // 冒充 npm 和 node：被执行就写一个标记文件
  for (const name of ['npm.bat', 'npm.cmd', 'node.bat', 'node.cmd'])
    await writeFile(join(root, name), `@echo off\r\necho ${name}>> "${marker}"\r\necho 99.0.0\r\n`)
})
afterEach(async () => {
  if (saved === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath
  else process.env.NoDefaultCurrentDirectoryInExePath = saved
  await rm(folder, { recursive: true, force: true })
})

function npmShim(): string | null {
  try {
    return (
      execFileSync('where.exe', ['npm'], { encoding: 'utf8', windowsHide: true })
        .split(/\r?\n/)
        .find(p => /\.cmd$/i.test(p)) ?? null
    )
  } catch {
    return null
  }
}

describe.skipIf(process.platform !== 'win32' || !npmShim())('项目里的 npm.bat 不会被执行', () => {
  it('用垫片的绝对路径取版本，垫片里的 node 也不从项目目录找', async () => {
    const out = await version('npm', npmShim()!, root)
    expect(existsSync(marker)).toBe(false)
    expect(out).toMatch(/^\d+\.\d+\.\d+/)
  })
})
