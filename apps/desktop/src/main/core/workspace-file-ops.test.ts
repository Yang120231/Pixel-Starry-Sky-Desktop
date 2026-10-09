// 文件新建 / 重命名 / 删除 / 内容搜索（docs/ui/files-search-terminal-pins.md §2、§3）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorkspaceFiles, validName } from './workspace-files'
import { parseGitGrepLine, GREP_LIMIT } from './workspace-grep'

let folder: string, root: string, service: WorkspaceFiles
const trashed: string[] = []
const ref = { projectId: 'project' }
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  folder = await mkdtemp(join(scratch, 'file-ops-test-'))
  root = join(folder, '项目 (1)')
  await mkdir(root)
  trashed.length = 0
  service = new WorkspaceFiles(value => ({ ref: value, name: 'p', path: root }), {
    trash: async (absolute, relative) => {
      trashed.push(relative)
      await rm(absolute, { recursive: true })
    },
  })
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('文件新建 / 重命名 / 删除', () => {
  it('新建文件和文件夹，重名与非法名称被拒绝', async () => {
    expect(await service.create(ref, 'src', 'folder')).toEqual({ path: 'src' })
    expect(await service.create(ref, 'src/新文件.ts', 'file')).toEqual({ path: 'src/新文件.ts' })
    expect(await readFile(join(root, 'src', '新文件.ts'), 'utf8')).toBe('')
    await expect(service.create(ref, 'src/新文件.ts', 'file')).rejects.toThrow('files.exists')
    await expect(service.create(ref, 'src/a*b.ts', 'file')).rejects.toThrow('files.invalidName')
    await expect(service.create(ref, 'missing/a.ts', 'file')).rejects.toThrow('files.parentMissing')
    await expect(service.create(ref, '../outside.ts', 'file')).rejects.toThrow('files.outsideProject')
    await expect(service.create(ref, 'C:/x.ts', 'file')).rejects.toThrow('files.relativePath')
    expect(validName('a.ts')).toBe(true)
    for (const bad of ['', '.', '..', 'a/b', 'a:b', 'name.', 'name ']) expect(validName(bad)).toBe(false)
  })
  it('重命名和移动只在项目内，目标已存在时拒绝，只改大小写允许', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'a.ts'), 'a')
    await writeFile(join(root, 'b.ts'), 'b')
    expect(await service.rename(ref, 'a.ts', 'src/c.ts')).toEqual({ path: 'src/c.ts' })
    expect(await readFile(join(root, 'src', 'c.ts'), 'utf8')).toBe('a')
    await expect(service.rename(ref, 'b.ts', 'src/c.ts')).rejects.toThrow('files.exists')
    await expect(service.rename(ref, 'b.ts', '../b.ts')).rejects.toThrow('files.outsideProject')
    await expect(service.rename(ref, '', 'x')).rejects.toThrow('files.projectRoot')
    await expect(service.rename(ref, 'src', 'src/inner')).rejects.toThrow('files.outsideProject')
    expect(await service.rename(ref, 'b.ts', 'B.ts')).toEqual({ path: 'B.ts' })
  })
  it('删除走回收站回调，删的是链接本身而不是项目外的目标', async () => {
    await mkdir(join(folder, 'outside'))
    await writeFile(join(folder, 'outside', 'keep.txt'), 'keep')
    await symlink(join(folder, 'outside'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(root, 'gone.txt'), 'x')
    await service.remove(ref, 'gone.txt')
    expect(trashed).toEqual(['gone.txt'])
    expect(await exists(join(root, 'gone.txt'))).toBe(false)
    await expect(service.remove(ref, 'linked/keep.txt')).rejects.toThrow('files.outsideProject')
    await expect(service.remove(ref, '')).rejects.toThrow('files.projectRoot')
    await expect(service.remove(ref, 'nope.txt')).rejects.toThrow('files.notFound')
    const noTrash = new WorkspaceFiles(value => ({ ref: value, name: 'p', path: root }))
    await expect(noTrash.remove(ref, 'linked')).rejects.toThrow('不能删除')
    expect(await readFile(join(folder, 'outside', 'keep.txt'), 'utf8')).toBe('keep')
  })
})

describe('文件内容搜索', () => {
  const seed = async () => {
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'src', 'a.ts'), 'const Alpha = 1\nconst beta = 2\n')
    await writeFile(join(root, 'src', 'b.ts'), 'export const ALPHA_TWO = 3\n')
    await writeFile(join(root, 'node_modules', 'x.js'), 'alpha in deps\n')
    await writeFile(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 97, 108, 112, 104, 97]))
  }
  it('不是 Git 仓库时逐个读文件：忽略大小写，跳过 node_modules 和二进制', async () => {
    await seed()
    const result = await service.grep(ref, 'alpha')
    expect(result.truncated).toBe(false)
    expect(result.matches.map(m => `${m.path}:${m.line}:${m.column}`).sort()).toEqual(['src/a.ts:1:7', 'src/b.ts:1:14'])
  })
  it('Git 仓库用 git grep，遵守 .gitignore，包含未跟踪文件', async () => {
    await seed()
    await writeFile(join(root, '.gitignore'), 'ignored.txt\nnode_modules\n')
    await writeFile(join(root, 'ignored.txt'), 'alpha hidden\n')
    try {
      execFileSync('git', ['init', '-q'], { cwd: root })
    } catch {
      return // 没有 git 时跳过
    }
    const result = await service.grep(ref, 'ALPHA')
    expect(result.matches.map(m => m.path).sort()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(result.matches.find(m => m.path === 'src/a.ts')).toMatchObject({
      line: 1,
      column: 7,
      text: 'const Alpha = 1',
    })
  })
  it('空查询、换行和过长查询被拒绝；git grep 输出逐行解析', async () => {
    await expect(service.grep(ref, '  ')).rejects.toThrow('files.queryInvalid')
    await expect(service.grep(ref, 'a\nb')).rejects.toThrow('files.queryInvalid')
    await expect(service.grep(ref, 'x'.repeat(201))).rejects.toThrow('files.queryInvalid')
    expect(parseGitGrepLine('src/a b.ts:12:5:  const x: number = 1')).toEqual({
      path: 'src/a b.ts',
      line: 12,
      column: 5,
      text: '  const x: number = 1',
    })
    expect(parseGitGrepLine('garbage')).toBeNull()
    expect(GREP_LIMIT).toBe(200)
  })
})
