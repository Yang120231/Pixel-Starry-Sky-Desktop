// 工作区选择的列表（issue #11，docs/ui/machines-workspaces.md §8）：只跑一条 git worktree list，真实 git，不访问网络。
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectCopy } from '../../../shared/types/project-tools'
import { git, parseWorktrees } from './common'
import { listWorkspaces, type ToolsOpContext } from './ops'

let root: string
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'workspaces-'))
  process.env.GIT_CEILING_DIRECTORIES = root
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function repo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-q', '-b', 'main'])
  for (const [k, v] of [
    ['user.email', 't@example.invalid'],
    ['user.name', 't'],
    ['commit.gpgsign', 'false'],
  ])
    await git(dir, ['config', k, v])
  await writeFile(join(dir, 'a.txt'), 'a\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-q', '-m', 'init'])
}

const copy = (id: string, path: string, branch: string): ProjectCopy => ({
  id,
  projectId: 'p',
  name: id,
  path,
  branch,
  baseCommit: 'x',
  baseBranch: 'main',
  createdAt: 0,
  updatedAt: 0,
  dirty: false,
  changedCount: 0,
  ahead: 0,
  behind: 0,
  sessions: [],
  error: null,
})

const context = (path: string, copies: ProjectCopy[]): ToolsOpContext =>
  ({
    host: { resolve: () => ({ projectId: 'p', name: '项目', path }) },
    tools: { copies: { store: { data: { version: 1, copies } } } },
  }) as unknown as ToolsOpContext

describe('工作区选择的列表', () => {
  it('解析 git worktree list --porcelain -z：分支、分离 HEAD', () => {
    expect(
      parseWorktrees(
        'worktree D:/r\0HEAD abc\0branch refs/heads/main\0\0worktree D:/r-copy\0HEAD def\0detached\0\0worktree D:/x\0HEAD 1\0branch refs/heads/feat/a\0\0',
      ),
    ).toEqual([
      { path: 'D:/r', branch: 'main' },
      { path: 'D:/r-copy', branch: 'HEAD' },
      { path: 'D:/x', branch: 'feat/a' },
    ])
  })

  it('项目和副本的分支一次读出；副本被删了标错误；分离 HEAD 写 HEAD', async () => {
    const project = join(root, 'project')
    await repo(project)
    const a = join(root, 'copy-a'),
      b = join(root, 'copy-b'),
      gone = join(root, 'copy-gone')
    await git(project, ['worktree', 'add', '-q', '-b', 'feat/a', a])
    await git(project, ['worktree', 'add', '-q', '--detach', b])
    await git(project, ['worktree', 'add', '-q', '-b', 'feat/gone', gone])
    await git(project, ['worktree', 'remove', gone])
    const list = await listWorkspaces(
      context(project, [copy('a', a, 'feat/a'), copy('b', b, 'old'), copy('gone', gone, 'feat/gone')]),
      'p',
    )
    expect(list.map(w => [w.copyId, w.branch, w.error])).toEqual([
      [null, 'main', null],
      ['a', 'feat/a', null],
      ['b', 'HEAD', null],
      ['gone', 'feat/gone', '工作树不存在或不是 Git 工作树'],
    ])
    expect(list[0]).toMatchObject({ projectId: 'p', name: '项目', path: project })
  })

  it('不是 Git 仓库：只有项目本身，没有分支和副本', async () => {
    const plain = join(root, 'plain')
    await mkdir(plain)
    const list = await listWorkspaces(context(plain, [copy('a', join(root, 'x'), 'feat/a')]), 'p')
    expect(list).toEqual([{ projectId: 'p', name: '项目', path: plain, copyId: null, branch: null, error: null }])
  })

  it('项目是仓库里的子目录：用这个仓库的分支', async () => {
    const top = join(root, 'top')
    await repo(top)
    await git(top, ['switch', '-q', '-c', 'dev'])
    const sub = join(top, 'web')
    await mkdir(sub)
    const list = await listWorkspaces(context(sub, []), 'p')
    expect(list).toEqual([{ projectId: 'p', name: '项目', path: sub, copyId: null, branch: 'dev', error: null }])
  })
})
