// 提交历史的真实 git 测试（docs/ui/git-panel.md §9.10）：在 scratch 下建仓库和裸远端，不访问网络。
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git, type ToolsHost } from './common'
import type { GitResult } from '../../../shared/types/project-tools'
import { GitTools } from './git'

let root: string,
  project: string,
  host: ToolsHost,
  busy = 0
const ref = { projectId: 'p' }
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'git-history-'))
  project = join(root, 'project')
  await mkdir(project)
  busy = 0
  process.env.GIT_CEILING_DIRECTORIES = root
  host = {
    resolve: () => ({ projectId: 'p', name: 'test', path: project }),
    plans: () => [],
    create: () => {
      throw new Error('no')
    },
    withStopped: async (_p, action) => action(),
    sessions: () => Array.from({ length: busy }, (_, i) => ({ id: 's' + i, title: 't', state: 'running' })),
  }
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
})

async function config(dir: string, name = 'Git test', email = 'git@example.invalid'): Promise<void> {
  for (const [k, v] of [
    ['user.email', email],
    ['user.name', name],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ])
    await git(dir, ['config', k, v])
}
async function init(dir = project): Promise<void> {
  await git(dir, ['init', '-q', '-b', 'main'])
  await config(dir)
}
let clock = 1_700_000_000
/** 提交时间每次加一分钟，排序稳定 */
async function commit(message: string, dir = project, extra: string[] = []): Promise<string> {
  clock += 60
  process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = `${clock} +0800`
  try {
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-q', '--allow-empty', '-m', message, ...extra])
  } finally {
    delete process.env.GIT_AUTHOR_DATE
    delete process.env.GIT_COMMITTER_DATE
  }
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}
const tools = () => new GitTools(host, () => {})

describe('Git 面板：提交历史', { timeout: 30_000 }, () => {
  it('提交里的文件带 local：相对项目目录；项目外、这次删掉的、后来删掉的为 null', async () => {
    const repo = project
    project = join(repo, 'web')
    await mkdir(join(project, 'src'), { recursive: true })
    await init(repo)
    await writeFile(join(project, 'src', 'keep.ts'), 'keep\n')
    await writeFile(join(project, 'gone.ts'), 'gone\n')
    await writeFile(join(project, 'later.ts'), 'later\n')
    await writeFile(join(repo, 'README.md'), 'root\n')
    const first = await commit('第一次', repo)
    await rm(join(project, 'gone.ts'))
    await writeFile(join(project, 'src', 'keep.ts'), 'keep 2\n')
    const second = await commit('删掉 gone.ts', repo)
    await rm(join(project, 'later.ts'))
    await commit('后来删掉 later.ts', repo)
    const g = tools()
    const firstFiles = (await g.show(ref, first)).files.map(f => [f.path, f.local])
    expect(firstFiles).toEqual([
      ['README.md', null],
      ['web/gone.ts', null],
      ['web/later.ts', null],
      ['web/src/keep.ts', 'src/keep.ts'],
    ])
    expect((await g.show(ref, second)).files.map(f => [f.code, f.path, f.local])).toEqual([
      ['D', 'web/gone.ts', null],
      ['M', 'web/src/keep.ts', 'src/keep.ts'],
    ])
  })

  it('空仓库没有历史；不是仓库时报 notRepo', async () => {
    const g = tools()
    await expect(g.log(ref, { scope: 'auto', skip: 0, limit: 50 })).rejects.toMatchObject({
      failure: { kind: 'notRepo' },
    })
    await init()
    expect(await g.log(ref, { scope: 'auto', skip: 0, limit: 50 })).toEqual({
      commits: [],
      more: false,
      shallow: false,
    })
    expect(await g.log(ref, { scope: 'all', skip: 0, limit: 50 })).toMatchObject({ commits: [] })
    expect(await g.refs(ref)).toMatchObject({ head: null, branch: 'main', base: null })
  })

  it('分支合并、标签、中文多行信息、改名和二进制、根提交、合并按第一父提交比较', async () => {
    await init()
    await writeFile(join(project, 'a.txt'), 'one\n')
    await writeFile(join(project, 'old.txt'), 'rename me\n')
    const rootHash = await commit('初始化项目\n\n第二段说明\n第三行')
    await git(project, ['tag', 'v0.1'])
    await git(project, ['switch', '-q', '-c', 'feat'])
    await git(project, ['mv', 'old.txt', 'new.txt'])
    await writeFile(join(project, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(project, 'a.txt'), 'one\ntwo\n')
    const featHash = await commit('功能：改名和二进制')
    await git(project, ['switch', '-q', 'main'])
    await writeFile(join(project, 'b.txt'), 'b\n')
    await commit('main 改动')
    await git(project, ['merge', '-q', '--no-ff', '-m', 'Merge feat', 'feat'])
    const g = tools()
    const page = await g.log(ref, { scope: 'auto', skip: 0, limit: 50 })
    // --topo-order：合并进来的分支整段排在一起
    expect(page.commits.map(c => c.subject)).toEqual(['Merge feat', '功能：改名和二进制', 'main 改动', '初始化项目'])
    const [merge, feat, , first] = page.commits
    expect(merge.parents).toHaveLength(2)
    expect(merge.refs).toEqual([{ kind: 'branch', name: 'main', current: true }])
    // 合并提交和第一父提交比较：带进来的是 feat 的三处改动
    expect(merge.stat).toEqual({ files: 3, insertions: 1, deletions: 0 })
    expect(feat.refs).toEqual([{ kind: 'branch', name: 'feat' }])
    expect(feat.hash).toBe(featHash)
    expect(first).toMatchObject({
      hash: rootHash,
      parents: [],
      subject: '初始化项目',
      body: '第二段说明\n第三行',
      author: 'Git test',
      email: 'git@example.invalid',
      refs: [{ kind: 'tag', name: 'v0.1' }],
    })

    const detail = await g.show(ref, featHash)
    expect(detail.from).toBe(rootHash)
    expect(detail.files.map(f => [f.code, f.path, f.origPath, f.insertions, f.deletions])).toEqual([
      ['M', 'a.txt', null, 1, 0],
      ['A', 'bin.dat', null, null, null],
      ['R', 'new.txt', 'old.txt', 0, 0],
    ])
    expect(detail.commit.stat).toEqual({ files: 3, insertions: 1, deletions: 0 })
    const mergeDetail = await g.show(ref, merge.hash)
    expect(mergeDetail.from).toBe(merge.parents[0])
    expect(mergeDetail.files.map(f => f.path)).toEqual(['a.txt', 'bin.dat', 'new.txt'])
    const rootDetail = await g.show(ref, rootHash)
    expect(rootDetail.from).toBeNull()
    expect(rootDetail.files.map(f => [f.code, f.path])).toEqual([
      ['A', 'a.txt'],
      ['A', 'old.txt'],
    ])
    // 「打开文件」用的 local：现在工作区里还有的才给；old.txt 后来改名成 new.txt，打不开
    expect(detail.files.map(f => [f.path, f.local])).toEqual([
      ['a.txt', 'a.txt'],
      ['bin.dat', 'bin.dat'],
      ['new.txt', 'new.txt'],
    ])
    expect(rootDetail.files.map(f => [f.path, f.local])).toEqual([
      ['a.txt', 'a.txt'],
      ['old.txt', null],
    ])

    // 一个文件的差异：改名按旧路径取原文，根提交和空文件比，二进制不比较
    expect(await g.diff(ref, { area: 'commit', path: 'a.txt', from: rootHash, to: featHash })).toMatchObject({
      original: 'one\n',
      modified: 'one\ntwo\n',
      binary: false,
    })
    expect(
      await g.diff(ref, { area: 'commit', path: 'new.txt', origPath: 'old.txt', from: rootHash, to: featHash }),
    ).toMatchObject({ original: 'rename me\n', modified: 'rename me\n' })
    expect(await g.diff(ref, { area: 'commit', path: 'a.txt', from: null, to: rootHash })).toMatchObject({
      original: null,
      modified: 'one\n',
    })
    expect(await g.diff(ref, { area: 'commit', path: 'bin.dat', from: rootHash, to: featHash })).toMatchObject({
      binary: true,
    })
  })

  it('章鱼合并有三个父提交；范围：自动只看当前分支，全部包含其他分支，自选的分支必须存在', async () => {
    await init()
    await writeFile(join(project, 'a.txt'), 'a\n')
    await commit('base')
    for (const name of ['x', 'y']) {
      await git(project, ['switch', '-q', '-c', name, 'main'])
      await writeFile(join(project, `${name}.txt`), name)
      await commit(`add ${name}`)
    }
    await git(project, ['switch', '-q', '-c', 'side', 'main'])
    await writeFile(join(project, 'side.txt'), 's')
    await commit('side only')
    await git(project, ['switch', '-q', 'main'])
    await git(project, ['merge', '-q', '--no-ff', '-m', 'octopus', 'x', 'y'])
    const g = tools()
    const auto = await g.log(ref, { scope: 'auto', skip: 0, limit: 50 })
    expect(auto.commits[0]).toMatchObject({ subject: 'octopus' })
    expect(auto.commits[0].parents).toHaveLength(3)
    expect(auto.commits.some(c => c.subject === 'side only')).toBe(false)
    const all = await g.log(ref, { scope: 'all', skip: 0, limit: 50 })
    expect(all.commits.some(c => c.subject === 'side only')).toBe(true)
    const picked = await g.log(ref, { scope: ['side'], skip: 0, limit: 50 })
    expect(picked.commits.map(c => c.subject)).toEqual(['side only', 'base'])
    await expect(g.log(ref, { scope: ['nope'], skip: 0, limit: 50 })).rejects.toThrow('分支不存在')
    await expect(g.log(ref, { scope: ['--all'], skip: 0, limit: 50 })).rejects.toThrow()
  })

  it('分页、搜索（信息不分大小写 / 作者 / 哈希前缀）', async () => {
    await init()
    const hashes: string[] = []
    for (let i = 1; i <= 7; i++) {
      await writeFile(join(project, 'n.txt'), String(i))
      hashes.push(await commit(i === 3 ? 'Fix LOGIN redirect' : `step ${i}`))
    }
    await config(project, '另一位作者', 'other@example.invalid')
    await writeFile(join(project, 'n.txt'), 'other')
    await commit('by other')
    const g = tools()
    const first = await g.log(ref, { scope: 'auto', skip: 0, limit: 3 })
    expect(first.commits.map(c => c.subject)).toEqual(['by other', 'step 7', 'step 6'])
    expect(first.more).toBe(true)
    const last = await g.log(ref, { scope: 'auto', skip: 6, limit: 3 })
    expect(last.commits.map(c => c.subject)).toEqual(['step 2', 'step 1'])
    expect(last.more).toBe(false)

    expect(
      (await g.log(ref, { scope: 'auto', search: 'login', skip: 0, limit: 50 })).commits.map(c => c.subject),
    ).toEqual(['Fix LOGIN redirect'])
    expect(
      (await g.log(ref, { scope: 'auto', search: '另一位', skip: 0, limit: 50 })).commits.map(c => c.subject),
    ).toEqual(['by other'])
    const byHash = await g.log(ref, { scope: 'auto', search: hashes[1].slice(0, 8), skip: 0, limit: 50 })
    expect(byHash.commits[0].hash).toBe(hashes[1])
    // 信息和作者都匹配时只出现一次
    const both = await g.log(ref, { scope: 'auto', search: 'other', skip: 0, limit: 50 })
    expect(both.commits.map(c => c.subject)).toEqual(['by other'])
    expect((await g.log(ref, { scope: 'auto', search: '-n1', skip: 0, limit: 50 })).commits).toEqual([])
  })

  it('未推送 / 未拉取 / 相对基础分支；基础分支在功能分支上才有', async () => {
    await init()
    await writeFile(join(project, 'a.txt'), 'one\n')
    await commit('base')
    const remote = join(root, 'remote.git')
    await git(root, ['init', '-q', '--bare', '-b', 'main', remote])
    await git(project, ['remote', 'add', 'origin', remote])
    await git(project, ['push', '-q', '-u', 'origin', 'main'])
    const g = tools()
    expect(await g.refs(ref)).toMatchObject({ branch: 'main', upstream: 'origin/main', base: null })

    const other = join(root, 'other')
    await git(root, ['clone', '-q', '-c', 'core.autocrlf=false', remote, other])
    await config(other, 'Other', 'o@example.invalid')
    await writeFile(join(other, 'theirs.txt'), 'x\n')
    await commit('theirs', other)
    await git(other, ['push', '-q'])
    await git(project, ['fetch', '-q'])
    await writeFile(join(project, 'mine.txt'), 'm\nm\n')
    await commit('mine')

    const outgoing = await g.compare(ref, 'outgoing')
    expect(outgoing).toMatchObject({ commits: 1, files: [{ path: 'mine.txt', code: 'A', insertions: 2 }] })
    const incoming = await g.compare(ref, 'incoming')
    expect(incoming).toMatchObject({ commits: 1, files: [{ path: 'theirs.txt', code: 'A' }] })
    expect(incoming.from).toBe(outgoing.from)
    // 自动范围包含上游：两边的提交都在
    const auto = await g.log(ref, { scope: 'auto', skip: 0, limit: 50 })
    expect(auto.commits.map(c => c.subject).sort()).toEqual(['base', 'mine', 'theirs'])
    expect(auto.commits.find(c => c.subject === 'theirs')?.refs).toEqual([{ kind: 'remote', name: 'origin/main' }])

    await git(project, ['switch', '-q', '-c', 'feature'])
    await writeFile(join(project, 'f.txt'), 'f\n')
    await commit('feature work')
    const refs = await g.refs(ref)
    expect(refs).toMatchObject({ branch: 'feature', upstream: null, base: 'main' })
    expect(refs.remote).toEqual(['origin/main'])
    const base = await g.compare(ref, 'base')
    expect(base).toMatchObject({ commits: 1, files: [{ path: 'f.txt' }] })
    await expect(g.compare(ref, 'outgoing')).rejects.toThrow('没有上游')
  })

  it('分离 HEAD、浅克隆', async () => {
    await init()
    await writeFile(join(project, 'a.txt'), '1')
    const one = await commit('one')
    await writeFile(join(project, 'a.txt'), '2')
    await commit('two')
    await writeFile(join(project, 'a.txt'), '3')
    await commit('three')
    await git(project, ['switch', '-q', '--detach', one])
    const g = tools()
    expect(await g.refs(ref)).toMatchObject({ head: one, branch: null })
    const detached = await g.log(ref, { scope: 'auto', skip: 0, limit: 50 })
    // 分离时自动范围 = HEAD + 基础分支 main
    expect(detached.commits.map(c => c.subject)).toEqual(['three', 'two', 'one'])
    expect(detached.commits[2].refs).toEqual([{ kind: 'head', name: 'HEAD' }])

    const shallow = join(root, 'shallow')
    await git(root, ['clone', '-q', '--depth', '1', `file://${project.replace(/\\/g, '/')}`, shallow, '-b', 'main'])
    const shallowTools = new GitTools(
      { ...host, resolve: () => ({ projectId: 'p', name: 's', path: shallow }) },
      () => {},
    )
    const page = await shallowTools.log(ref, { scope: 'auto', skip: 0, limit: 50 })
    expect(page).toMatchObject({ shallow: true, commits: [{ subject: 'three' }] })
  })

  it('在某个提交上新建分支：不切过去时不动工作区、会话运行中也可以；切过去要等会话停下；非法参数被拒', async () => {
    await init()
    await writeFile(join(project, 'a.txt'), '1')
    const one = await commit('one')
    await writeFile(join(project, 'a.txt'), '2')
    await commit('two')
    const g = tools()
    busy = 1
    const made = await g.createBranch(ref, { name: 'from-one', start: one })
    expect(made.ok).toBe(true)
    expect((await git(project, ['rev-parse', 'from-one'])).trim()).toBe(one)
    expect((await g.refs(ref)).branch).toBe('main')
    const blocked = await g.createBranch(ref, { name: 'from-one-b', start: one, switch: true })
    expect(blocked).toMatchObject({ ok: false, failure: { kind: 'busy' } })
    busy = 0
    expect((await g.createBranch(ref, { name: 'from-one-b', start: one, switch: true })).ok).toBe(true)
    expect((await g.refs(ref)).branch).toBe('from-one-b')
    expect(() => g.createBranch(ref, { name: 'x', start: 'HEAD~1' })).toThrow('参数不正确')
    await expect(g.show(ref, 'not-a-hash')).rejects.toThrow('参数不正确')
    await expect(g.diff(ref, { area: 'commit', path: 'a.txt', from: '--output=x', to: one })).rejects.toThrow(
      '参数不正确',
    )
    await expect(g.compare(ref, 'sideways')).rejects.toThrow('参数不正确')
  })
})

describe('Git 面板：历史里会改动仓库的操作（第二期）', { timeout: 30_000 }, () => {
  const ok = (r: GitResult) => {
    if (!r.ok) throw new Error(`${r.failure.kind}: ${r.failure.detail}`)
    return r.status
  }
  const fail = (r: GitResult) => {
    if (r.ok) throw new Error('expected failure')
    return r.failure
  }
  const subjects = async (dir = project) => (await git(dir, ['log', '--format=%s'])).trim().split('\n')
  /** main：base → two；side：base → side change；返回各提交 */
  async function twoBranches() {
    await init()
    await writeFile(join(project, 'a.txt'), 'one\n')
    const base = await commit('base')
    await writeFile(join(project, 'a.txt'), 'two\n')
    const two = await commit('two')
    await git(project, ['switch', '-q', '-c', 'side', base])
    await writeFile(join(project, 's.txt'), 's\n')
    const side = await commit('side change')
    await git(project, ['switch', '-q', 'main'])
    return { base, two, side }
  }

  it('检出提交是分离 HEAD；会话运行时拒绝', async () => {
    const { base } = await twoBranches()
    const g = tools()
    busy = 1
    expect(fail(await g.historyAction(ref, { kind: 'checkout', hash: base })).kind).toBe('busy')
    busy = 0
    const s = ok(await g.historyAction(ref, { kind: 'checkout', hash: base }))
    expect(s).toMatchObject({ detached: true, head: base })
  })

  it('cherry-pick 和 revert（含合并提交按第一父提交）', async () => {
    const { side, two } = await twoBranches()
    const g = tools()
    ok(await g.historyAction(ref, { kind: 'cherryPick', hash: side }))
    expect((await subjects())[0]).toBe('side change')
    ok(await g.historyAction(ref, { kind: 'revert', hash: two }))
    expect((await subjects())[0]).toBe('Revert "two"')
    expect(await readFile(join(project, 'a.txt'), 'utf8')).toBe('one\n')
    // 合并提交
    await git(project, ['switch', '-q', '-c', 'other'])
    await writeFile(join(project, 'o.txt'), 'o\n')
    await commit('other change')
    await git(project, ['switch', '-q', 'main'])
    await git(project, ['merge', '-q', '--no-ff', '-m', 'merge other', 'other'])
    const merge = (await git(project, ['rev-parse', 'HEAD'])).trim()
    ok(await g.historyAction(ref, { kind: 'revert', hash: merge }))
    expect((await subjects())[0]).toBe('Revert "merge other"')
    await git(project, ['switch', '-q', 'side'])
    ok(await g.historyAction(ref, { kind: 'cherryPick', hash: merge }))
    expect(await readFile(join(project, 'o.txt'), 'utf8')).toBe('o\n')
  })

  it('cherry-pick 冲突：给出「中止」，状态显示进行中，中止后恢复', async () => {
    await init()
    await writeFile(join(project, 'a.txt'), 'base\n')
    const base = await commit('base')
    await writeFile(join(project, 'a.txt'), 'main\n')
    await commit('main edit')
    await git(project, ['switch', '-q', '-c', 'side', base])
    await writeFile(join(project, 'a.txt'), 'side\n')
    const side = await commit('side edit')
    await git(project, ['switch', '-q', 'main'])
    const g = tools()
    const r = await g.historyAction(ref, { kind: 'cherryPick', hash: side })
    expect(fail(r)).toMatchObject({ kind: 'conflict', remedies: ['abort'] })
    expect(r.status).toMatchObject({ operation: 'cherry-pick' })
    // 有进行中的操作时不能 reset
    expect(fail(await g.historyAction(ref, { kind: 'reset', hash: base, mode: 'hard' })).kind).toBe('invalid')
    expect(ok(await g.operation(ref, 'abort')).operation).toBeNull()
    expect(await readFile(join(project, 'a.txt'), 'utf8')).toBe('main\n')
  })

  it('reset：soft 留在暂存区、mixed 留在工作区、hard 丢掉', async () => {
    const { base } = await twoBranches()
    const g = tools()
    const head = (await git(project, ['rev-parse', 'HEAD'])).trim()
    let s = ok(await g.historyAction(ref, { kind: 'reset', hash: base, mode: 'soft' }))
    expect(s.head).toBe(base)
    expect(s.staged.map(f => f.path)).toEqual(['a.txt'])
    await git(project, ['reset', '-q', '--hard', head])
    s = ok(await g.historyAction(ref, { kind: 'reset', hash: base, mode: 'mixed' }))
    expect([s.staged.length, s.unstaged.map(f => f.path)]).toEqual([0, ['a.txt']])
    await git(project, ['reset', '-q', '--hard', head])
    await writeFile(join(project, 'new.txt'), 'untracked\n')
    s = ok(await g.historyAction(ref, { kind: 'reset', hash: base, mode: 'hard' }))
    expect([s.staged.length, s.unstaged.length]).toEqual([0, 0])
    // 未跟踪文件不动
    expect(s.untracked.map(f => f.path)).toEqual(['new.txt'])
    expect(() => g.historyAction(ref, { kind: 'reset', hash: base, mode: 'keep' })).toThrow('参数不正确')
  })

  it('标签：轻量 / 附注、非法名字、删除；会话运行时也可以', async () => {
    const { base, two } = await twoBranches()
    const g = tools()
    busy = 1
    ok(await g.historyAction(ref, { kind: 'tag', hash: base, name: 'v0.1' }))
    ok(await g.historyAction(ref, { kind: 'tag', hash: two, name: 'v0.2', message: '第二版\n\n说明' }))
    expect((await git(project, ['cat-file', '-t', 'v0.1'])).trim()).toBe('commit')
    expect((await git(project, ['cat-file', '-t', 'v0.2'])).trim()).toBe('tag')
    expect((await git(project, ['tag', '-l', '--format=%(contents)', 'v0.2'])).trim()).toBe('第二版\n\n说明')
    expect(fail(await g.historyAction(ref, { kind: 'tag', hash: base, name: 'bad..name' })).kind).toBe('invalid')
    expect(fail(await g.historyAction(ref, { kind: 'tag', hash: base, name: '-x' })).kind).toBe('invalid')
    expect(fail(await g.historyAction(ref, { kind: 'tag', hash: base, name: 'v0.1' })).detail).toMatch(/already exists/)
    ok(await g.historyAction(ref, { kind: 'deleteTag', name: 'v0.1' }))
    expect((await g.refs(ref)).tags).toEqual(['v0.2'])
    expect(fail(await g.historyAction(ref, { kind: 'deleteTag', name: 'nope' })).kind).toBe('invalid')
  })

  it('删除分支：没合并的提示 unmerged，强制可以删；不能删当前分支', async () => {
    await twoBranches()
    const g = tools()
    expect(fail(await g.historyAction(ref, { kind: 'deleteBranch', name: 'side' })).kind).toBe('unmerged')
    ok(await g.historyAction(ref, { kind: 'deleteBranch', name: 'side', force: true }))
    expect((await g.refs(ref)).local).toEqual(['main'])
    expect(fail(await g.historyAction(ref, { kind: 'deleteBranch', name: 'main' })).detail).toBe('不能删除当前分支')
    expect(() => g.historyAction(ref, { kind: 'push' })).toThrow('参数不正确')
  })

  it('和任意分支 / 提交比较', async () => {
    const { base, side } = await twoBranches()
    const g = tools()
    const r = await g.compare(ref, { from: 'main', to: side })
    expect(r.commits).toBe(1)
    expect(r.files.map(f => [f.code, f.path])).toEqual([
      ['M', 'a.txt'],
      ['A', 's.txt'],
    ])
    expect((await g.compare(ref, { from: base, to: 'HEAD' })).commits).toBe(1)
    await expect(g.compare(ref, { from: 'HEAD~1', to: side })).rejects.toThrow('分支不存在')
    await expect(g.compare(ref, { from: 'main', to: '--all' })).rejects.toThrow()
  })
})

describe('Git 面板：单文件历史（§9.15）', { timeout: 30_000 }, () => {
  /** a.txt 改两次后改名成 docs/b.txt 再改一次；另有不相关的提交和一个二进制文件 */
  async function fileRepo() {
    await init()
    await writeFile(join(project, 'a.txt'), 'one\n')
    const c1 = await commit('add a')
    await writeFile(join(project, 'other.txt'), 'x\n')
    await commit('unrelated')
    await writeFile(join(project, 'a.txt'), 'one\ntwo\n')
    const c2 = await commit('edit a')
    await mkdir(join(project, 'docs'))
    await git(project, ['mv', 'a.txt', 'docs/b.txt'])
    const c3 = await commit('move a to docs/b')
    await writeFile(join(project, 'docs', 'b.txt'), 'one\ntwo\nthree\nfour\n')
    const c4 = await commit('edit b')
    await writeFile(join(project, 'img.bin'), Buffer.from([0, 1, 2]))
    await commit('add binary')
    await writeFile(join(project, 'img.bin'), Buffer.from([0, 9, 9, 9]))
    await commit('change binary')
    return { c1, c2, c3, c4 }
  }

  it('跟着改名往前找，每个提交带这个文件的路径、状态和增删行数，没有其他文件的提交', async () => {
    const { c1, c2, c3, c4 } = await fileRepo()
    const page = await tools().log(ref, { scope: 'auto', skip: 0, limit: 50, path: 'docs/b.txt' })
    expect(page.path).toBe('docs/b.txt')
    expect(page.commits.map(c => c.hash)).toEqual([c4, c3, c2, c1])
    expect(
      page.commits.map(c => [c.file?.code, c.file?.path, c.file?.origPath, c.file?.insertions, c.file?.deletions]),
    ).toEqual([
      ['M', 'docs/b.txt', null, 2, 0],
      ['R', 'docs/b.txt', 'a.txt', 0, 0],
      ['M', 'a.txt', null, 1, 0],
      ['A', 'a.txt', null, 1, 0],
    ])
    expect(page.commits[0].stat).toBeNull()
    // HEAD 在后面改二进制文件的提交上，不在这个文件的历史里
    expect(page.commits[0].refs).toEqual([])
    // 二进制文件没有行数
    const bin = await tools().log(ref, { scope: 'auto', skip: 0, limit: 50, path: 'img.bin' })
    expect(bin.commits.map(c => [c.subject, c.file?.insertions])).toEqual([
      ['change binary', null],
      ['add binary', null],
    ])
  })

  it('分页、在文件历史里搜索、Windows 路径分隔符', async () => {
    await fileRepo()
    const g = tools()
    const first = await g.log(ref, { scope: 'auto', skip: 0, limit: 2, path: 'docs\\b.txt' })
    expect(first.commits.map(c => c.subject)).toEqual(['edit b', 'move a to docs/b'])
    expect(first.more).toBe(true)
    const rest = await g.log(ref, { scope: 'auto', skip: 2, limit: 2, path: 'docs/b.txt' })
    expect(rest.commits.map(c => c.subject)).toEqual(['edit a', 'add a'])
    expect(rest.more).toBe(false)
    const found = await g.log(ref, { scope: 'auto', skip: 0, limit: 50, path: 'docs/b.txt', search: 'EDIT' })
    expect(found.commits.map(c => c.subject)).toEqual(['edit b', 'edit a'])
    expect(found.commits[1].file?.path).toBe('a.txt')
  })

  it('工作区是子目录时，文件树的路径按工作区算，提交里的路径按仓库根目录算；非法路径被拒', async () => {
    await fileRepo()
    const sub = new GitTools(
      { ...host, resolve: () => ({ projectId: 'p', name: 'docs', path: join(project, 'docs') }) },
      () => {},
    )
    const fromTree = await sub.log(ref, { scope: 'auto', skip: 0, limit: 50, path: 'b.txt' })
    expect(fromTree.path).toBe('docs/b.txt')
    expect(fromTree.commits).toHaveLength(4)
    const fromRepo = await sub.log(ref, { scope: 'auto', skip: 0, limit: 50, path: 'docs/b.txt', pathBase: 'repo' })
    expect(fromRepo.commits.map(c => c.hash)).toEqual(fromTree.commits.map(c => c.hash))
    const g = tools()
    for (const bad of ['../x', 'a/../../x', '', './', 'a//b'])
      await expect(g.log(ref, { scope: 'auto', skip: 0, limit: 50, path: bad })).rejects.toThrow()
    // 不存在的文件：没有提交
    expect((await g.log(ref, { scope: 'auto', skip: 0, limit: 50, path: 'nope.txt' })).commits).toEqual([])
  })
})
