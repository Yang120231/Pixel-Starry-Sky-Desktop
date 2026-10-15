import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IGNORED_STATUS } from '../../shared/types/workspace'
import { WorkspaceFiles, parseIgnoredOutput } from './workspace-files'

// 被 .gitignore 忽略的路径（文件树变暗）。临时目录放在系统临时目录下：本仓库的 scratch/ 自己就是被忽略的，会干扰结果。

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
})()

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, windowsHide: true })

describe('parseIgnoredOutput', () => {
  it('按 NUL 切开，文件夹去掉结尾 /，空串、. 和 ./ 丢掉', () => {
    const out = ['build/', 'a/b.log', '', '.', './', 'node_modules/'].join('\0') + '\0'
    expect(parseIgnoredOutput(out)).toEqual(['build', 'a/b.log', 'node_modules'])
  })
  it('空输出给空列表；条数封顶 20000', () => {
    expect(parseIgnoredOutput('')).toEqual([])
    const many = Array.from({ length: 20_010 }, (_, i) => `f${i}.log`).join('\0')
    expect(parseIgnoredOutput(many)).toHaveLength(20_000)
  })
})

describe.skipIf(!hasGit)('status() 里的被忽略标记', () => {
  let folder: string
  const ref = { projectId: 'p' }
  const filesAt = (path: string) => new WorkspaceFiles(value => ({ ref: value, name: 'proj', path }))
  beforeEach(async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), 'pixelsky-ignored-')))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('忽略的文件夹、未跟踪目录里的忽略文件都标 I；子目录项目按自己的相对路径', async () => {
    const root = join(folder, 'repo')
    await mkdir(join(root, 'build'), { recursive: true })
    await mkdir(join(root, 'untracked', 'deep'), { recursive: true })
    await mkdir(join(root, 'sub'), { recursive: true })
    git(root, 'init', '--quiet')
    await writeFile(join(root, '.gitignore'), 'build/\n*.log\n')
    await writeFile(join(root, 'build', 'out.js'), 'x')
    await writeFile(join(root, 'untracked', 'deep', 'z.log'), 'x')
    await writeFile(join(root, 'untracked', 'deep', 'keep.txt'), 'x')
    await writeFile(join(root, 'sub', 'a.log'), 'x')
    await writeFile(join(root, 'sub', 'b.txt'), 'x')
    const status = await filesAt(root).status(ref)
    expect(status['build']).toBe(IGNORED_STATUS)
    // B5a：不能用 --no-empty-directory，否则这条会丢
    expect(status['untracked/deep/z.log']).toBe(IGNORED_STATUS)
    expect(status['untracked/deep/keep.txt']).toBeUndefined()
    expect(status['sub/a.log']).toBe(IGNORED_STATUS)
    expect(status['']).toBeUndefined()

    const nested = await filesAt(join(root, 'sub')).status(ref)
    expect(nested['a.log']).toBe(IGNORED_STATUS)
  })

  it('项目在上层仓库的忽略目录里：不标 ""/"."，也不报错（B5b）', async () => {
    const parent = join(folder, 'parent')
    const proj = join(parent, 'sub', 'proj')
    await mkdir(proj, { recursive: true })
    git(parent, 'init', '--quiet')
    await writeFile(join(parent, '.gitignore'), 'sub/\n')
    await writeFile(join(proj, 'a.txt'), 'x')
    const status = await filesAt(proj).status(ref)
    for (const key of ['', '.', './']) expect(status[key]).toBeUndefined()
    expect(Object.values(status)).not.toContain(IGNORED_STATUS)
  })

  it('不是 Git 仓库：返回空，不报错', async () => {
    await writeFile(join(folder, 'a.txt'), 'x')
    expect(await filesAt(folder).status(ref)).toEqual({})
  })
})
