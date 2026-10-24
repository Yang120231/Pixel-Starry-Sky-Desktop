// 影子 Git 仓库（docs/ui/undo-changes.md §2），用真实 git
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShadowRepo, workPath } from '../src/checkpoints'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
let work: string
let repo: ShadowRepo

beforeEach(() => {
  root = makeTmp('checkpoints')
  work = join(root, 'work')
  mkdirSync(work)
  repo = new ShadowRepo(join(root, 'shadow'), work)
})
afterEach(() => removeTmp(root))

const write = (path: string, text: string): void => {
  mkdirSync(join(work, path, '..'), { recursive: true })
  writeFileSync(join(work, path), text)
}

describe('ShadowRepo', () => {
  it('拍快照、比较、取回内容', async () => {
    write('a.txt', 'one\n')
    write('src/b.ts', 'export {}\n')
    const before = await repo.capture()
    write('a.txt', 'one\ntwo\n')
    write('new.txt', 'hi\n')
    const after = await repo.capture()
    const changes = await repo.diff(before, after)
    expect(changes).toEqual([
      { path: 'a.txt', status: 'modified', insertions: 1, deletions: 0 },
      { path: 'new.txt', status: 'added', insertions: 1, deletions: 0 },
    ])
    expect((await repo.blob(before, 'a.txt'))?.toString()).toBe('one\n')
    expect(await repo.blob(before, 'new.txt')).toBeNull()
    // 没有变化时树 id 相同
    expect(await repo.capture()).toBe(after)
  })

  it('默认排除依赖目录，也跟着项目的 .gitignore', async () => {
    write('.gitignore', 'secret.env\n')
    write('node_modules/x/index.js', 'x\n')
    write('secret.env', 'k=v\n')
    write('keep.txt', 'k\n')
    const tree = await repo.capture()
    expect(await repo.blob(tree, 'keep.txt')).not.toBeNull()
    expect(await repo.blob(tree, 'secret.env')).toBeNull()
    expect(await repo.ignored(['secret.env', 'node_modules/x/index.js', 'keep.txt'])).toEqual(
      new Set(['secret.env', 'node_modules/x/index.js']),
    )
  })

  it('项目是 Git 仓库时借它的对象库，不碰项目自己的索引和提交', async () => {
    write('a.txt', 'committed\n')
    const git = (...args: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: work, encoding: 'utf8' })
    git('init', '--quiet')
    git('add', '.')
    git('commit', '--quiet', '-m', 'init')
    const head = git('rev-parse', 'HEAD')
    write('b.txt', 'untracked\n')
    const tree = await repo.capture()
    expect(readFileSync(join(root, 'shadow', 'objects', 'info', 'alternates'), 'utf8')).toContain('objects')
    expect((await repo.blob(tree, 'b.txt'))?.toString()).toBe('untracked\n')
    expect((await repo.blob(tree, 'a.txt'))?.toString()).toBe('committed\n')
    // 项目的状态不变：b.txt 仍是未跟踪，HEAD 没动
    expect(git('status', '--porcelain')).toBe('?? b.txt\n')
    expect(git('rev-parse', 'HEAD')).toBe(head)
  })

  it('大小和删除', async () => {
    write('a.txt', randomBytes(20_000).toString('hex'))
    await repo.capture()
    expect(await repo.size()).toBeGreaterThan(0)
    await repo.destroy()
    expect(existsSync(join(root, 'shadow'))).toBe(false)
  })

  it('不按项目的 .gitattributes 转换换行、不跑过滤器：取回的内容和磁盘上一字不差', async () => {
    write('.gitattributes', '* text=auto eol=lf\n*.bin filter=lfs diff=lfs merge=lfs -text\n')
    write('crlf.txt', 'a\r\nb\r\n')
    write('data.bin', 'raw\n')
    const tree = await repo.capture()
    expect((await repo.blob(tree, 'crlf.txt'))?.toString()).toBe('a\r\nb\r\n')
    expect((await repo.blob(tree, 'data.bin'))?.toString()).toBe('raw\n')
  })

  it('上次超时留下的索引锁不挡下一次快照', async () => {
    write('a.txt', 'a\n')
    await repo.capture()
    writeFileSync(join(root, 'shadow', 'index.lock'), '')
    write('a.txt', 'b\n')
    const tree = await repo.capture()
    expect((await repo.blob(tree, 'a.txt'))?.toString()).toBe('b\n')
  })

  it('工作目录外的路径', () => {
    expect(workPath(work, join(work, 'src', 'a.ts'))).toBe('src/a.ts')
    expect(workPath(work, 'src/a.ts')).toBe('src/a.ts')
    expect(workPath(work, join(root, 'other.txt'))).toBeNull()
  })
})
