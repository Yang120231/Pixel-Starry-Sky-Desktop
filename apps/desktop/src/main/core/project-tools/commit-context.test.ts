// AI 写提交信息要发的改动（docs/ui/ai-commit-codex-warnings-history.md §2.2）：真实 git，在 scratch 下建仓库
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git, type ToolsHost } from './common'
import { assemble, contextKind, CONTEXT_LIMITS, cutAtLine, splitPatch } from './commit-context'
import { GitTools } from './git'

let root: string, project: string, tools: GitTools
const ref = { projectId: 'p' }
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'git-context-'))
  project = join(root, 'project')
  await mkdir(project)
  process.env.GIT_CEILING_DIRECTORIES = root
  const host: ToolsHost = {
    resolve: () => ({ projectId: 'p', name: 'test', path: project }),
    plans: () => [],
    create: () => {
      throw new Error('no')
    },
    withStopped: async (_p, action) => action(),
    sessions: () => [],
  }
  tools = new GitTools(host, () => {})
  await git(project, ['init', '-b', 'main'])
  for (const [k, v] of [
    ['user.email', 'git@example.invalid'],
    ['user.name', 'Git test'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ])
    await git(project, ['config', k, v])
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
})

const write = (path: string, text: string) => writeFile(join(project, path), text)
async function commitAll(message: string): Promise<void> {
  await git(project, ['add', '-A'])
  await git(project, ['commit', '-q', '-m', message])
}

describe('collectCommitContext', () => {
  it('还没有提交：和空树比，分支名照样有，最近标题为空', async () => {
    await write('a.ts', 'export const a = 1\n')
    await git(project, ['add', 'a.ts'])
    const c = await tools.commitContext(ref, { scope: 'staged' })
    expect(c.branch).toBe('main')
    expect(c.recent).toEqual([])
    expect(c.files).toEqual([{ path: 'a.ts', origPath: null, code: 'A', insertions: 1, deletions: 0, content: 'diff' }])
    expect(c.patch).toContain('+export const a = 1')
  })

  it('有暂存只看暂存的；all 看全部改动，含未跟踪的新文件；最近标题新的在前、不含合并提交', async () => {
    await write('a.ts', 'one\ntwo\n')
    await write('b.ts', 'b\n')
    await commitAll('feat: 第一个')
    await commitAll('第二个').catch(() => {}) // 没有改动，提交失败也无所谓
    await write('a.ts', 'one\nTWO\n')
    await write('b.ts', 'b changed\n')
    await git(project, ['add', 'a.ts'])
    await write('new.md', '# 新文件\n第二行\n')

    const staged = await tools.commitContext(ref, { scope: 'staged' })
    expect(staged.files.map(f => f.path)).toEqual(['a.ts'])
    expect(staged.patch).toContain('-two\n+TWO')
    expect(staged.patch).not.toContain('b changed')
    expect(staged.recent).toEqual(['feat: 第一个'])

    const all = await tools.commitContext(ref, { scope: 'all' })
    expect(all.files.map(f => [f.path, f.code, f.content])).toEqual([
      ['a.ts', 'M', 'diff'],
      ['b.ts', 'M', 'diff'],
      ['new.md', 'A', 'diff'],
    ])
    expect(all.patch).toContain('+b changed')
    expect(all.patch).toContain('new file (untracked)')
    expect(all.patch).toContain('+# 新文件\n+第二行\n')
  })

  it('锁文件只列名字；密钥文件连改动行都不发；二进制只写是二进制', async () => {
    await write('readme.md', 'hi\n')
    await commitAll('init')
    await write('pnpm-lock.yaml', 'lockfileVersion: 9\nsecret-ish: no\n')
    await write('.env', 'API_KEY=sk-should-never-leave\n')
    await write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]).toString('latin1'))
    await write('id_ed25519', 'PRIVATE KEY\n')
    await git(project, ['add', '-A'])
    const c = await tools.commitContext(ref, { scope: 'staged' })
    expect(Object.fromEntries(c.files.map(f => [f.path, f.content]))).toEqual({
      '.env': 'secret',
      id_ed25519: 'secret',
      'logo.png': 'binary',
      'pnpm-lock.yaml': 'listed',
    })
    expect(c.patch).toBe('')
    expect(c.patch).not.toContain('sk-should-never-leave')

    // 未跟踪的密钥文件也一样
    await write('.env.production', 'TOKEN=also-secret\n')
    const all = await tools.commitContext(ref, { scope: 'all' })
    expect(all.files.find(f => f.path === '.env.production')?.content).toBe('secret')
    expect(all.patch).not.toContain('also-secret')
  })

  it('改名带上旧路径，正文对得上', async () => {
    await write('old-name.ts', Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n')
    await commitAll('init')
    await git(project, ['mv', 'old-name.ts', 'new-name.ts'])
    await write('new-name.ts', Array.from({ length: 20 }, (_, i) => `line ${i === 3 ? 'three' : i}`).join('\n') + '\n')
    await git(project, ['add', '-A'])
    const c = await tools.commitContext(ref, { scope: 'staged' })
    expect(c.files).toEqual([
      expect.objectContaining({ path: 'new-name.ts', origPath: 'old-name.ts', code: 'R', content: 'diff' }),
    ])
    expect(c.patch).toContain('+line three')
  })

  it('参数不对时报错', async () => {
    await expect(tools.commitContext(ref, { scope: 'everything' })).rejects.toThrow('参数不正确')
    await expect(tools.commitContext(ref, null)).rejects.toThrow('参数不正确')
  })
})

describe('上限', () => {
  const file = (path: string) => ({ path, origPath: null, code: 'M' as const, insertions: 1, deletions: 1 })
  const section = (path: string, size: number) => `diff --git a/${path} b/${path}\n` + 'x'.repeat(size - 1) + '\n'

  it('单个文件太长只放开头；总额度用完的只列名字', () => {
    const limits = { ...CONTEXT_LIMITS, total: 3000, perFile: 1200 }
    const { files, patch } = assemble(
      [
        { file: file('a'), section: section('a', 500) },
        { file: file('b'), section: section('b', 5000) },
        { file: file('c'), section: section('c', 1000) },
        { file: file('d'), section: section('d', 1000) },
        { file: file('e'), section: null },
      ],
      limits,
    )
    expect(files.map(f => f.content)).toEqual(['diff', 'cut', 'diff', 'omitted', 'omitted'])
    expect(patch.length).toBeLessThanOrEqual(limits.total)
    expect(patch).toContain('（这个文件后面的改动省略了）')
  })

  it('认得锁文件、压缩文件、密钥文件（看文件名，不看目录）', () => {
    expect(contextKind('web/package-lock.json')).toBe('listed')
    expect(contextKind('Cargo.lock')).toBe('listed')
    expect(contextKind('dist/app.min.js')).toBe('listed')
    expect(contextKind('dist/app.js.map')).toBe('listed')
    expect(contextKind('.env')).toBe('secret')
    expect(contextKind('deploy/.env.production')).toBe('secret')
    expect(contextKind('certs/server.key')).toBe('secret')
    expect(contextKind('home/.npmrc')).toBe('secret')
    expect(contextKind('src/env.ts')).toBe(null)
    expect(contextKind('src/keyboard.ts')).toBe(null)
    expect(contextKind('docs/secrets-handling.md')).toBe(null)
  })

  it('按 diff --git 拆分；在换行处截断', () => {
    const sections = splitPatch('diff --git a/x b/x\n+1\ndiff --git a/y b/z\n+2\n')
    expect([...sections.keys()]).toEqual(['a/x b/x', 'a/y b/z'])
    expect(sections.get('a/y b/z')).toBe('diff --git a/y b/z\n+2\n')
    expect(cutAtLine('aaaa\nbbbb\ncccc\n', 12)).toBe('aaaa\nbbbb\n')
    expect(cutAtLine('short', 12)).toBe('short')
  })
})
