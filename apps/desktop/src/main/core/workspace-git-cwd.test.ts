// Windows 上按裸名启动程序时会先在 cwd 里找：项目根目录里的 git.exe 不能顶替真正的 git（审查报告 2026-10-14 第 1 条）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorkspaceFiles } from './workspace-files'
import { grepWorkspace } from './workspace-grep'

const fake = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'hostname.exe')
let folder: string, root: string, service: WorkspaceFiles
const ref = { projectId: 'project' }
// 设了这个变量时系统不在 cwd 里找程序（Claude Code 的 shell 就设了），测试时去掉，按普通用户的环境跑
const saved = process.env.NoDefaultCurrentDirectoryInExePath

beforeEach(async () => {
  delete process.env.NoDefaultCurrentDirectoryInExePath
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  folder = await mkdtemp(join(scratch, 'git-cwd-test-'))
  root = join(folder, 'repo')
  await mkdir(root)
  const git = (...args: string[]): void => void execFileSync('git', ['-C', root, ...args], { windowsHide: true })
  git('init', '--quiet')
  await writeFile(join(root, 'a.txt'), 'original needle\n')
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init')
  await writeFile(join(root, 'a.txt'), 'changed needle\n')
  // 被忽略的文件：git grep 搜不到，退回逐个读文件时才会搜到
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
  await writeFile(join(root, 'ignored.txt'), 'needle\n')
  // 冒充 git：hostname.exe 只打印主机名
  await copyFile(fake, join(root, 'git.exe'))
  service = new WorkspaceFiles(value => ({ ref: value, name: '测试项目', path: root }))
})
afterEach(async () => {
  if (saved === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath
  else process.env.NoDefaultCurrentDirectoryInExePath = saved
  await rm(folder, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'win32')('项目里的 git.exe 不会被执行', () => {
  it('文件树状态、HEAD 内容、内容搜索都用真正的 git', async () => {
    expect((await service.status(ref))['a.txt']).toBe('M')
    expect(await service.headContent(ref, 'a.txt')).toBe('original needle\n')
    const found = await grepWorkspace(root, 'needle')
    expect(found.matches.map(m => m.path)).toEqual(['a.txt'])
  })
})
