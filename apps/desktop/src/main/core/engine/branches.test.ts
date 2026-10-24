// 开分支 / 合并回主会话（docs/ui/branch-merge.md）：真实的临时 Git 仓库 + 真实的副本，引擎用假的
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineHost } from '@pixelsky/engine'
import type { ForkOptions, Item, NoticeBranchMerge, SessionBranch, SessionRecord } from '@pixelsky/protocol'
import { git, type ToolsHost } from '../project-tools/common'
import { ProjectTools } from '../project-tools/tools'
import { branchStatus, branchSummary, createBranch, draftSummary, mergeBranch, prepareBranch } from './branches'

let root: string, project: string, tools: ProjectTools, host: FakeHost

class FakeHost {
  records = new Map<string, SessionRecord>()
  items = new Map<string, Item[]>()
  merges: { id: string; merge: NoticeBranchMerge; patch: Partial<SessionBranch> }[] = []
  states = new Map<string, 'idle' | 'running'>()
  reply: string | Error = new Error('没有登录')
  private n = 0
  record(id: string): SessionRecord | null {
    return this.records.get(id) ?? null
  }
  sessions() {
    return [...this.records.values()].map(record => ({ record, state: this.states.get(record.id) ?? 'idle' }))
  }
  async forkSession(id: string, _itemId: string | null, title: string, opts: ForkOptions = {}) {
    const source = this.records.get(id)!
    const record: SessionRecord = {
      ...source,
      id: `branch-${++this.n}`,
      title,
      cwd: opts.cwd ?? source.cwd,
      forkedFrom: { sessionId: id, title: source.title },
      branch: opts.branch ? { ...opts.branch, startAfter: null, mergedAt: null } : null,
    }
    this.records.set(record.id, record)
    return { record, text: '' }
  }
  branchItems(id: string): Item[] {
    return this.items.get(id) ?? []
  }
  recordMerge(id: string, merge: NoticeBranchMerge, patch: Partial<SessionBranch>): void {
    this.merges.push({ id, merge, patch })
    const record = this.records.get(id)!
    record.branch = { ...record.branch!, ...patch, mergedAt: Date.now() }
  }
  dropPendingMerge(): void {}
  async oneShot() {
    if (this.reply instanceof Error) throw this.reply
    return { text: this.reply, model: null, usage: null }
  }
}

const deps = () => ({ host: host as unknown as EngineHost, tools })
const out = async (cwd: string, args: string[]) => (await git(cwd, args)).trim()
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  )

beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'branch-unit-'))
  project = join(root, 'project')
  await mkdir(project)
  await git(project, ['init', '-q', '-b', 'main'])
  await git(project, ['config', 'user.name', 'T'])
  await git(project, ['config', 'user.email', 't@example.com'])
  await git(project, ['config', 'core.autocrlf', 'false'])
  await writeFile(join(project, 'a.txt'), 'a1\na2\na3\n')
  await writeFile(join(project, 'b.txt'), 'b1\nb2\nb3\nb4\nb5\n')
  await git(project, ['add', '-A'])
  await git(project, ['commit', '-q', '-m', 'init'])
  host = new FakeHost()
  host.records.set('main', {
    id: 'main',
    projectId: 'p',
    cwd: project,
    engine: 'claude',
    title: '主会话',
  } as SessionRecord)
  const toolsHost: ToolsHost = {
    resolve(ref) {
      if (ref.projectId !== 'p') throw new Error('unknown')
      return { projectId: 'p', name: 'test', path: project }
    },
    plans: () => [],
    sessions: () => [],
    create: (id, cwd) => ({ id: 's', projectId: id, cwd }) as ReturnType<ToolsHost['create']>,
    withStopped: async (_path, action) => action(),
  }
  tools = new ProjectTools(join(root, 'tools'), toolsHost, () => {})
  await tools.init()
})

afterEach(async () => {
  await tools.shutdown()
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
})

async function branchWithCopy(carry = true) {
  const forked = await createBranch(deps(), 'main', null, {
    title: '试试',
    copy: { name: 'try', branch: 'pixelsky/try', carry },
  })
  return { id: forked.record.id, cwd: forked.record.cwd }
}

describe('开分支', () => {
  it('弹窗信息：分支名、没提交的改动个数、已有分支和副本目录', async () => {
    await writeFile(join(project, 'a.txt'), 'changed\n')
    await writeFile(join(project, 'new.txt'), 'n\n')
    const info = await prepareBranch(deps(), 'main')
    expect(info).toMatchObject({ git: true, baseBranch: 'main', dirty: 2, branches: ['main'], copies: [] })
    expect(info.copyRoot).toContain('.pixelsky')
  })

  it('建副本带上没提交的改动（含新文件），上级的暂存区不动；不是 Git 仓库时不能建副本', async () => {
    await writeFile(join(project, 'a.txt'), 'changed\n')
    await writeFile(join(project, 'new.txt'), 'n\n')
    const before = await out(project, ['status', '--porcelain'])
    const { id, cwd } = await branchWithCopy()
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('changed\n')
    expect(await readFile(join(cwd, 'new.txt'), 'utf8')).toBe('n\n')
    expect(await out(cwd, ['status', '--porcelain'])).toBe('')
    expect(await out(project, ['status', '--porcelain'])).toBe(before)
    const record = host.records.get(id)!
    expect(record.branch).toMatchObject({ gitBranch: 'pixelsky/try', baseBranch: 'main', copyId: expect.any(String) })
    expect(record.branch!.startCommit).not.toBe(await out(project, ['rev-parse', 'HEAD']))
    expect(await out(cwd, ['rev-parse', 'HEAD'])).toBe(record.branch!.startCommit)

    // 放在系统临时目录：scratch 在本仓库里面，会被当成 Git 仓库
    const plain = await mkdtemp(join(tmpdir(), 'pixelsky-plain-'))
    host.records.set('plain', { ...host.records.get('main')!, id: 'plain', cwd: plain })
    await expect(
      createBranch(deps(), 'plain', null, { title: 'x', copy: { name: 'p2', branch: 'pixelsky/p2', carry: true } }),
    ).rejects.toThrow('不是 Git 仓库')
    await rm(plain, { recursive: true, force: true })
  })

  it('不带没提交的改动时从 HEAD 开；同目录模式不建副本', async () => {
    await writeFile(join(project, 'a.txt'), 'changed\n')
    const { id, cwd } = await branchWithCopy(false)
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('a1\na2\na3\n')
    expect(host.records.get(id)!.branch!.startCommit).toBe(await out(project, ['rev-parse', 'HEAD']))
    const shared = await createBranch(deps(), 'main', null, { title: '同目录', copy: null })
    expect(shared.record.cwd).toBe(project)
    expect(shared.record.branch).toMatchObject({ copyId: null, startCommit: null, baseBranch: 'main' })
  })

  it('项目是仓库里的子文件夹：分支会话在副本里对应的子文件夹；删了副本的分支不能再开分支', async () => {
    await mkdir(join(project, 'web'))
    await writeFile(join(project, 'web', 'w.txt'), 'w\n')
    await git(project, ['add', '-A'])
    await git(project, ['commit', '-q', '-m', 'web'])
    host.records.get('main')!.cwd = join(project, 'web')
    const { id, cwd } = await branchWithCopy(false)
    expect(cwd).not.toBe(join(project, 'web'))
    expect(await readFile(join(cwd, 'w.txt'), 'utf8')).toBe('w\n')
    host.records.get(id)!.branch!.copyRemoved = true
    await expect(createBranch(deps(), id, null, { title: 'x', copy: null })).rejects.toThrow('副本已经删掉')
  })
})

describe('合并', () => {
  it('上级没动过的文件直接换上；能压成一个提交时只提交这些文件，之后删副本和分支', async () => {
    await writeFile(join(project, 'a.txt'), 'local\n')
    const { id, cwd } = await branchWithCopy(false)
    await writeFile(join(cwd, 'b.txt'), 'b1\nb2\nB3\nb4\nb5\n')
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    const status = await branchStatus(deps(), id)
    expect(status).toMatchObject({
      mode: 'copy',
      copyExists: true,
      conflicts: 0,
      canCommit: true,
      parentBranch: 'main',
    })
    expect(status.files).toEqual([
      { path: 'b.txt', status: 'modified', additions: 1, deletions: 1, merge: 'replace' },
      { path: 'c.txt', status: 'added', additions: 1, deletions: 0, merge: 'replace' },
    ])
    const result = await mergeBranch(deps(), id, {
      code: { commit: true, message: 'feat: 合并试试' },
      removeCopy: true,
      summary: '· 改了 b',
    })
    expect(result).toEqual({ code: 'committed', files: 2 })
    expect(await readFile(join(project, 'c.txt'), 'utf8')).toBe('c\n')
    expect(await out(project, ['log', '-1', '--format=%s'])).toBe('feat: 合并试试')
    expect(await out(project, ['show', '--name-only', '--format=', 'HEAD'])).toBe('b.txt\nc.txt')
    // 上级自己没提交的改动不跟着提交
    expect(await out(project, ['status', '--porcelain'])).toBe('M a.txt')
    expect(await exists(cwd)).toBe(false)
    expect(await out(project, ['branch', '--list', 'pixelsky/try'])).toBe('')
    expect(host.merges[0]).toMatchObject({
      merge: { code: 'committed', commitMessage: 'feat: 合并试试', copyRemoved: true, summary: '· 改了 b' },
      patch: { copyRemoved: true },
    })
  })

  it('上级又改过同一个文件：不冲突时三方自动合并；有冲突一个文件都不写', async () => {
    const { id, cwd } = await branchWithCopy()
    await writeFile(join(project, 'b.txt'), 'B1\nb2\nb3\nb4\nb5\n')
    await writeFile(join(cwd, 'b.txt'), 'b1\nb2\nb3\nb4\nB5\n')
    let status = await branchStatus(deps(), id)
    expect(status.files[0]).toMatchObject({ path: 'b.txt', merge: 'auto' })
    // 上级里这个文件有没提交的改动：不能压成一个提交
    expect(status).toMatchObject({ canCommit: false, dirtyThere: ['b.txt'] })
    await expect(
      mergeBranch(deps(), id, { code: { commit: true, message: 'x' }, removeCopy: false, summary: null }),
    ).rejects.toThrow('不能直接提交')

    await writeFile(join(cwd, 'a.txt'), 'branch\n')
    await writeFile(join(project, 'a.txt'), 'parent\n')
    status = await branchStatus(deps(), id)
    expect(status.conflicts).toBe(1)
    expect(status.files.find(f => f.path === 'a.txt')).toMatchObject({ merge: 'conflict', reason: 'conflict' })
    await expect(
      mergeBranch(deps(), id, { code: { commit: false, message: '' }, removeCopy: false, summary: null }),
    ).rejects.toThrow('合不上')
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('B1\nb2\nb3\nb4\nb5\n')

    await writeFile(join(project, 'a.txt'), 'a1\na2\na3\n')
    const result = await mergeBranch(deps(), id, {
      code: { commit: false, message: '' },
      removeCopy: false,
      summary: null,
    })
    expect(result).toEqual({ code: 'applied', files: 2 })
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('B1\nb2\nb3\nb4\nB5\n')
    expect(await readFile(join(project, 'a.txt'), 'utf8')).toBe('branch\n')
  })

  it('副本留着：起点挪到这次合并的位置（挂着引用，不会被 gc 清掉），再合并只算之后的改动', async () => {
    const { id, cwd } = await branchWithCopy()
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    await mergeBranch(deps(), id, { code: { commit: false, message: '' }, removeCopy: false, summary: null })
    const start = host.merges[0].patch.startCommit
    expect(start).toBeTruthy()
    expect(await out(project, ['rev-parse', `refs/pixelsky/branch-start/${id}`])).toBe(start)
    expect((await branchStatus(deps(), id)).files).toEqual([])
    await writeFile(join(cwd, 'd.txt'), 'd\n')
    expect((await branchStatus(deps(), id)).files.map(f => f.path)).toEqual(['d.txt'])
    // 之后合并时删副本：引用也一起删
    await mergeBranch(deps(), id, { code: { commit: false, message: '' }, removeCopy: true, summary: null })
    expect(await out(project, ['for-each-ref', 'refs/pixelsky/'])).toBe('')
  })

  it('两边都删了同一个文件不算冲突；文件名里的 [ ] 按字面提交，不当通配符', async () => {
    await writeFile(join(project, 'x.txt'), 'x\n')
    await git(project, ['add', '-A'])
    await git(project, ['commit', '-q', '-m', 'x'])
    const { id, cwd } = await branchWithCopy()
    await rm(join(cwd, 'a.txt'))
    await rm(join(project, 'a.txt'))
    await writeFile(join(cwd, '[x].txt'), 'literal\n')
    let status = await branchStatus(deps(), id)
    expect(status.files.find(f => f.path === 'a.txt')).toMatchObject({ status: 'deleted', merge: 'auto' })
    expect(status.conflicts).toBe(0)
    // 上级删 a.txt 没提交：不能压成提交；先提交掉
    await git(project, ['commit', '-q', '-am', 'rm a'])
    // x.txt 上级有没提交的改动，[x].txt 当通配符时会把它也提交进去
    await writeFile(join(project, 'x.txt'), 'dirty\n')
    status = await branchStatus(deps(), id)
    expect(status.canCommit).toBe(true)
    await mergeBranch(deps(), id, { code: { commit: true, message: 'm' }, removeCopy: false, summary: null })
    expect(await out(project, ['show', '--name-only', '--format=', 'HEAD'])).toBe('[x].txt')
    expect(await out(project, ['status', '--porcelain'])).toBe('M x.txt')
  })

  it('同目录模式只合并对话；会话在跑时不能合并；代码没合并时不删副本', async () => {
    const shared = await createBranch(deps(), 'main', null, { title: '同目录', copy: null })
    expect(await mergeBranch(deps(), shared.record.id, { code: null, removeCopy: false, summary: '· 结论' })).toEqual({
      code: 'none',
      files: 0,
    })
    expect(host.merges.at(-1)!.merge).toMatchObject({ code: 'none', summary: '· 结论' })

    const { id, cwd } = await branchWithCopy()
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    host.states.set('main', 'running')
    await expect(mergeBranch(deps(), id, { code: null, removeCopy: false, summary: 'x' })).rejects.toThrow(
      '上级会话正在运行',
    )
    host.states.set('main', 'idle')
    expect(await mergeBranch(deps(), id, { code: null, removeCopy: true, summary: 'x' })).toEqual({
      code: 'skipped',
      files: 1,
    })
    expect(await exists(cwd)).toBe(true)
    await expect(mergeBranch(deps(), id, { code: null, removeCopy: false, summary: null })).rejects.toThrow('至少')
  })
})

describe('摘要', () => {
  it('AI 写成了就用它的；没写成用整理好的草稿', async () => {
    const { id, cwd } = await branchWithCopy()
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    host.items.set(id, [
      { kind: 'user', id: 'u1', text: '换成短信验证码', createdAt: 1 } as Item,
      { kind: 'assistant', id: 'a1', text: '改好了', status: 'completed' } as Item,
    ])
    const draft = await branchSummary(deps(), id, 'zh')
    expect(draft).toMatchObject({ ai: false, problem: '没有登录' })
    expect(draft.text).toBe(draftSummary(['换成短信验证码'], ['c.txt'], 'zh'))
    expect(draft.text).toContain('改了 1 个文件：c.txt')
    host.reply = '```\n分支里做了什么\n· 改成短信\n```'
    expect(await branchSummary(deps(), id, 'zh')).toEqual({ text: '分支里做了什么\n· 改成短信', ai: true })
  })
})
