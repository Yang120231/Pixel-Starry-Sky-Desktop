// 开分支 / 合并回主会话（docs/ui/branch-merge.md）：真实的临时 Git 仓库 + 真实的副本，引擎用假的
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineHost } from '@pixelsky/engine'
import type { ForkOptions, Item, NoticeBranchMerge, SessionBranch, SessionRecord } from '@pixelsky/protocol'
import { git, type ToolsHost } from '../project-tools/common'
import { ProjectTools } from '../project-tools/tools'
import {
  branchStatus,
  branchSummary,
  commitPaths,
  createBranch,
  draftSummary,
  mergeBranch,
  prepareBranch,
} from './branches'

// chmod 可以让它失败：模拟存不了权限的文件系统（vfat U 盘等）；
// onSnapshot：第 n 次建快照（snapshotTree 的临时目录）之前调，用来在合并的各个时刻插进改动
const fsMock = vi.hoisted(() => ({
  chmodFails: false,
  onSnapshot: null as ((n: number) => Promise<void> | void) | null,
  snapshots: 0,
  /** 每次写文件之前调（合并写回上级的那一刻） */
  onWrite: null as ((path: string) => Promise<void> | void) | null,
}))
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const chmod: typeof real.chmod = (...args) =>
    fsMock.chmodFails ? Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' })) : real.chmod(...args)
  const mkdtemp = (async (prefix: string, ...rest: unknown[]) => {
    if (fsMock.onSnapshot && String(prefix).includes('pixelsky-branch-')) await fsMock.onSnapshot(++fsMock.snapshots)
    return (real.mkdtemp as (...a: unknown[]) => Promise<string>)(prefix, ...rest)
  }) as typeof real.mkdtemp
  const writeFile = (async (path: unknown, ...rest: unknown[]) => {
    await fsMock.onWrite?.(String(path))
    return (real.writeFile as (...a: unknown[]) => Promise<void>)(path, ...rest)
  }) as typeof real.writeFile
  return { ...real, chmod, mkdtemp, writeFile, default: { ...real, chmod, mkdtemp, writeFile } }
})

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
  fsMock.chmodFails = false
  fsMock.onSnapshot = null
  fsMock.snapshots = 0
  fsMock.onWrite = null
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
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
    // 不带结尾的分隔符（Claude 按工作目录编码项目文件夹，多一个「-」就找不到会话记录）
    expect(cwd).not.toMatch(/[\\/]$/)
    expect(cwd).toBe(resolve(tools.copies.get(host.records.get(id)!.branch!.copyId!).path, 'web'))
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
      codeUnknown: false,
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

const applyOnly = { code: { commit: false, message: '' }, removeCopy: false, summary: null }

describe('合并：算不出改动、删副本失败', () => {
  it('A→B→C：B 合并回 A 删了副本后，C 算不出改动，不能合并代码也不删副本', async () => {
    const b = await branchWithCopy()
    const c = await createBranch(deps(), b.id, null, {
      title: '再试试',
      copy: { name: 'try2', branch: 'pixelsky/try2', carry: true },
    })
    await writeFile(join(c.record.cwd, 'c.txt'), 'c\n')
    // B 自己没改代码：合并时删副本
    await mergeBranch(deps(), b.id, { code: { commit: false, message: '' }, removeCopy: true, summary: 'b' })
    expect(await exists(b.cwd)).toBe(false)

    const status = await branchStatus(deps(), c.record.id)
    expect(status).toMatchObject({ copyExists: true, codeUnknown: true, files: [] })
    await expect(
      mergeBranch(deps(), c.record.id, { code: { commit: false, message: '' }, removeCopy: true, summary: 'c' }),
    ).rejects.toThrow('算不出副本里的改动')
    // 只合并对话：代码算没合并，要删副本也不删
    expect(await mergeBranch(deps(), c.record.id, { code: null, removeCopy: true, summary: 'c' })).toEqual({
      code: 'skipped',
      files: 0,
    })
    expect(host.merges.at(-1)).toMatchObject({ merge: { code: 'skipped', copyRemoved: false }, patch: {} })
    expect(await readFile(join(c.record.cwd, 'c.txt'), 'utf8')).toBe('c\n')
  })

  it('删副本失败时代码起点照样挪到这次合并的位置', async () => {
    const { id, cwd } = await branchWithCopy()
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    vi.spyOn(tools.copies, 'remove').mockRejectedValueOnce(new Error('副本被占用'))
    const result = await mergeBranch(deps(), id, { ...applyOnly, removeCopy: true })
    expect(result).toEqual({ code: 'applied', files: 1, removeError: '副本被占用' })
    const start = host.merges[0].patch.startCommit
    expect(start).toBeTruthy()
    expect(await out(project, ['rev-parse', `refs/pixelsky/branch-start/${id}`])).toBe(start)
    expect((await branchStatus(deps(), id)).files).toEqual([])
  })
})

describe('写回上级', () => {
  async function commitAll(message: string) {
    await git(project, ['add', '-A'])
    await git(project, ['commit', '-q', '-m', message])
  }

  it('只改大小写的改名先删后写，文件不会丢，压成提交时也是改名；文件夹换成同名文件也能写', async () => {
    await writeFile(join(project, 'Readme.md'), 'readme\n')
    await mkdir(join(project, 'lib'))
    await writeFile(join(project, 'lib', 'x.txt'), 'x\n')
    await mkdir(join(project, 'docs', 'deep'), { recursive: true })
    await writeFile(join(project, 'docs', 'deep', 'only.txt'), 'o\n')
    await commitAll('files')
    const { id, cwd } = await branchWithCopy()
    await git(cwd, ['mv', 'Readme.md', 'README.md'])
    await rm(join(cwd, 'lib'), { recursive: true })
    await writeFile(join(cwd, 'lib'), 'now a file\n')
    await rm(join(cwd, 'docs'), { recursive: true })
    expect((await branchStatus(deps(), id)).files.map(f => [f.path, f.status])).toEqual([
      ['README.md', 'added'],
      ['Readme.md', 'deleted'],
      ['docs/deep/only.txt', 'deleted'],
      ['lib', 'added'],
      ['lib/x.txt', 'deleted'],
    ])
    expect(await mergeBranch(deps(), id, { ...applyOnly, code: { commit: true, message: 'ren' } })).toEqual({
      code: 'committed',
      files: 5,
    })
    const names = await readdir(project)
    expect(names).toContain('README.md')
    expect(names).not.toContain('Readme.md')
    expect(await readFile(join(project, 'README.md'), 'utf8')).toBe('readme\n')
    expect(await readFile(join(project, 'lib'), 'utf8')).toBe('now a file\n')
    // 删空的文件夹一起删掉
    expect(await exists(join(project, 'docs'))).toBe(false)
    // 不分大小写的磁盘上 git add 认不出只改大小写的改名：提交里也要是新名字，提交之后干干净净
    expect(await out(project, ['ls-tree', '-r', '--name-only', 'HEAD'])).toBe('README.md\na.txt\nb.txt\nlib')
    expect(await out(project, ['ls-files'])).toBe('README.md\na.txt\nb.txt\nlib')
    expect(await out(project, ['status', '--porcelain'])).toBe('')
  })

  it('途经的文件夹是符号链接时不写（不会写到链接指向的地方）', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    const { id, cwd } = await branchWithCopy()
    await mkdir(join(cwd, 'ext'))
    await writeFile(join(cwd, 'ext', 'new.txt'), 'n\n')
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    // Windows 上用 junction，不用管理员权限
    await symlink(outside, join(project, 'ext'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(mergeBranch(deps(), id, applyOnly)).rejects.toThrow('路径里有符号链接')
    expect(await readdir(outside)).toEqual([])
    // 准备阶段就发现了，一个文件都没写
    expect(await exists(join(project, 'c.txt'))).toBe(false)
  })

  it('上级里的文件是符号链接：删掉链接再写，不改链接指向的文件', async () => {
    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'secret\n')
    await git(project, ['config', 'core.symlinks', 'true'])
    // 建不了文件链接（Windows 没开开发者模式）时跳过
    const made = await symlink(outside, join(project, 'link.txt')).then(
      () => true,
      () => false,
    )
    if (!made) return
    await commitAll('link')
    const { id, cwd } = await branchWithCopy()
    await rm(join(cwd, 'link.txt'))
    await writeFile(join(cwd, 'link.txt'), 'plain\n')
    expect(await mergeBranch(deps(), id, applyOnly)).toEqual({ code: 'applied', files: 1 })
    expect((await lstat(join(project, 'link.txt'))).isSymbolicLink()).toBe(false)
    expect(await readFile(join(project, 'link.txt'), 'utf8')).toBe('plain\n')
    expect(await readFile(outside, 'utf8')).toBe('secret\n')
  })

  it('符号链接按 core.symlinks 建链接或写成文本；可执行位跟着 Git 里的模式', async () => {
    await git(project, ['config', 'core.filemode', 'false'])
    await git(project, ['config', 'core.symlinks', 'false'])
    const { id, cwd } = await branchWithCopy()
    // 副本单独关掉 core.symlinks：工作区里的普通文件保留索引里的 120000（和 Windows 上一样），上级的设置另外改
    await git(project, ['config', 'extensions.worktreeConfig', 'true'])
    await git(cwd, ['config', '--worktree', 'core.symlinks', 'false'])
    const addLink = async (name: string, target: string) => {
      await writeFile(join(cwd, name), target)
      const sha = await out(cwd, ['hash-object', '-w', name])
      await git(cwd, ['update-index', '--add', '--cacheinfo', `120000,${sha},${name}`])
    }
    await addLink('lnk', 'a.txt')
    await writeFile(join(cwd, 'b.txt'), 'b1\nb2\nb3\nb4\nb5\nb6\n')
    await git(cwd, ['update-index', '--chmod=+x', 'b.txt'])
    // 上级 core.symlinks=false：写成内容是链接目标的文本文件
    await mergeBranch(deps(), id, applyOnly)
    expect((await lstat(join(project, 'lnk'))).isSymbolicLink()).toBe(false)
    expect(await readFile(join(project, 'lnk'), 'utf8')).toBe('a.txt')
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('b1\nb2\nb3\nb4\nb5\nb6\n')
    if (process.platform !== 'win32') expect((await stat(join(project, 'b.txt'))).mode & 0o111).not.toBe(0)

    // 上级允许符号链接：建链接（Windows 建不了时退回写成文本）
    await git(project, ['config', 'core.symlinks', 'true'])
    await addLink('lnk2', 'b.txt')
    expect((await branchStatus(deps(), id)).files.map(f => f.path)).toEqual(['lnk2'])
    await mergeBranch(deps(), id, applyOnly)
    const info = await lstat(join(project, 'lnk2'))
    if (info.isSymbolicLink()) expect(await readlink(join(project, 'lnk2'))).toBe('b.txt')
    else expect(await readFile(join(project, 'lnk2'), 'utf8')).toBe('b.txt')
  })

  it('写盘用检出的样子：按上级的 .gitattributes 换行（直接换上的和三方合并的都是）', async () => {
    await writeFile(join(project, '.gitattributes'), '*.crlf text eol=crlf\n')
    await writeFile(join(project, 'm.crlf'), 'm1\r\nm2\r\nm3\r\nm4\r\nm5\r\n')
    await commitAll('crlf')
    const { id, cwd } = await branchWithCopy()
    expect(await readFile(join(cwd, 'm.crlf'), 'utf8')).toBe('m1\r\nm2\r\nm3\r\nm4\r\nm5\r\n')
    await writeFile(join(cwd, 'n.crlf'), 'n1\nn2\n')
    await writeFile(join(cwd, 'm.crlf'), 'm1\r\nm2\r\nm3\r\nm4\r\nM5\r\n')
    await writeFile(join(project, 'm.crlf'), 'M1\r\nm2\r\nm3\r\nm4\r\nm5\r\n')
    const status = await branchStatus(deps(), id)
    expect(status.files.find(f => f.path === 'm.crlf')).toMatchObject({ merge: 'auto' })
    await mergeBranch(deps(), id, applyOnly)
    expect(await readFile(join(project, 'n.crlf'), 'utf8')).toBe('n1\r\nn2\r\n')
    expect(await readFile(join(project, 'm.crlf'), 'utf8')).toBe('M1\r\nm2\r\nm3\r\nm4\r\nM5\r\n')
  })

  it('LFS 指针换不成文件内容时不写，上级里的文件不动', async () => {
    // 装了 git-lfs 时让它跳过下载、原样给出指针（和没装 git-lfs 一样；建副本时也要，对象下载不到）
    vi.stubEnv('GIT_LFS_SKIP_SMUDGE', '1')
    // 装了 git-lfs 时 add 也走它的过滤：指针原样存进去（没装时按普通文件存，一样）
    const pointer = (n: string) => `version https://git-lfs.github.com/spec/v1\noid sha256:${n.repeat(64)}\nsize 12\n`
    await writeFile(join(project, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n')
    await writeFile(join(project, 'big.bin'), pointer('a'))
    await commitAll('lfs')
    const { id, cwd } = await branchWithCopy()
    await writeFile(join(cwd, 'big.bin'), pointer('b'))
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    await expect(mergeBranch(deps(), id, applyOnly)).rejects.toThrow('没能把 Git LFS 指针换成文件内容')
    expect(await readFile(join(project, 'big.bin'), 'utf8')).toBe(pointer('a'))
    expect(await exists(join(project, 'c.txt'))).toBe(false)
  })

  it('子模块的改动算冲突，不当成删除', async () => {
    const { id, cwd } = await branchWithCopy()
    const head = await out(cwd, ['rev-parse', 'HEAD'])
    // 没初始化的子模块：空文件夹 + 索引里的 gitlink
    await mkdir(join(cwd, 'sub'))
    await git(cwd, ['update-index', '--add', '--cacheinfo', `160000,${head},sub`])
    const status = await branchStatus(deps(), id)
    expect(status.files.find(f => f.path === 'sub')).toMatchObject({ merge: 'conflict', reason: 'submodule' })
    expect(status.conflicts).toBe(1)
  })

  it('普通文件改成符号链接：先删文件再建链接；压成提交时按 Git 里的模式（链接、可执行位）提交', async () => {
    // Windows 上 git init 设 core.filemode=false，这里各平台一样
    await git(project, ['config', 'core.filemode', 'false'])
    await git(project, ['config', 'core.symlinks', 'true'])
    const { id, cwd } = await branchWithCopy()
    await git(project, ['config', 'extensions.worktreeConfig', 'true'])
    await git(cwd, ['config', '--worktree', 'core.symlinks', 'false'])
    // 副本里 a.txt 改成指向 b.txt 的链接，b.txt 加上可执行位
    await writeFile(join(cwd, 'a.txt'), 'b.txt')
    const sha = await out(cwd, ['hash-object', '-w', 'a.txt'])
    await git(cwd, ['update-index', '--cacheinfo', `120000,${sha},a.txt`])
    await writeFile(join(cwd, 'b.txt'), 'b1\nb2\nb3\nb4\nb5\nb6\n')
    await git(cwd, ['update-index', '--chmod=+x', 'b.txt'])
    const canLink = await symlink('x', join(root, 'probe')).then(
      () => true,
      () => false,
    )
    const result = await mergeBranch(deps(), id, { ...applyOnly, code: { commit: true, message: 'link' } })
    expect(result).toEqual({ code: 'committed', files: 2 })
    // 能建链接的环境里一定是链接（原来的普通文件不会让它退回写成文本）；建不了时写成内容是链接目标的文本
    expect((await lstat(join(project, 'a.txt'))).isSymbolicLink()).toBe(canLink)
    if (canLink) expect(await readlink(join(project, 'a.txt'))).toBe('b.txt')
    else expect(await readFile(join(project, 'a.txt'), 'utf8')).toBe('b.txt')
    const tree = (await out(project, ['ls-tree', 'HEAD', 'a.txt', 'b.txt'])).split('\n').map(l => l.split(' ')[0])
    expect(tree).toEqual(['120000', '100755'])
    if (canLink) expect(await out(project, ['status', '--porcelain'])).toBe('')
  })

  it('设不上可执行位（存不了权限的文件系统）不算写失败', async () => {
    const { id, cwd } = await branchWithCopy()
    await writeFile(join(cwd, 'b.txt'), 'b1\nb2\nb3\nb4\nb5\nb6\n')
    await git(cwd, ['update-index', '--chmod=+x', 'b.txt'])
    fsMock.chmodFails = true
    expect(await mergeBranch(deps(), id, applyOnly)).toEqual({ code: 'applied', files: 1 })
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('b1\nb2\nb3\nb4\nb5\nb6\n')
  })

  it('提交只按算好的模式和对象名：别的暂存改动不跟着提交，文件名按字面；和 HEAD 一样时不提交', async () => {
    await writeFile(join(project, 'x.txt'), 'x\n')
    await commitAll('x')
    await writeFile(join(project, '[x].txt'), 'literal\n')
    await writeFile(join(project, 'x.txt'), 'dirty\n')
    await writeFile(join(project, 'staged.txt'), 's\n')
    await git(project, ['add', 'staged.txt'])
    const sha = await out(project, ['hash-object', '-w', '[x].txt'])
    const entry = { path: '[x].txt', entry: { mode: '100644', sha } }
    expect(await commitPaths(project, [entry], 'm')).toBe(true)
    expect(await out(project, ['show', '--name-only', '--format=', 'HEAD'])).toBe('[x].txt')
    expect(await out(project, ['status', '--porcelain'])).toBe('A  staged.txt\n M x.txt')
    expect(await commitPaths(project, [entry], 'm')).toBe(false)
    expect(await commitPaths(project, [{ path: 'gone.txt', entry: null }], 'm')).toBe(false)
    expect(await out(project, ['log', '--format=%s'])).toBe('m\nx\ninit')
  })
})

describe('合并期间有变化', () => {
  // 合并里建快照的顺序：1 副本、2 上级（算合并），3 上级（写之前核对），4 副本（删副本之前核对）
  it('算合并期间上级开始运行：不写，提示上级在运行', async () => {
    const { id, cwd } = await branchWithCopy(false)
    await writeFile(join(cwd, 'b.txt'), 'branch\n')
    vi.spyOn(tools.copies, 'verify').mockImplementation(async () => void host.states.set('main', 'running'))
    await expect(mergeBranch(deps(), id, applyOnly)).rejects.toThrow('上级会话正在运行')
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('b1\nb2\nb3\nb4\nb5\n')
    expect(host.merges).toHaveLength(0)
  })

  it('算完到写之前要写的文件又被改了：不写、留着新内容；改的是别的文件照常合并', async () => {
    const { id, cwd } = await branchWithCopy(false)
    await writeFile(join(cwd, 'b.txt'), 'branch\n')
    fsMock.onSnapshot = n => (n === 3 ? writeFile(join(project, 'b.txt'), 'user\n') : undefined)
    await expect(mergeBranch(deps(), id, applyOnly)).rejects.toThrow('又改过了')
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('user\n')
    expect(host.merges).toHaveLength(0)

    await git(project, ['checkout', '--', 'b.txt'])
    fsMock.snapshots = 0
    fsMock.onSnapshot = n => (n === 3 ? writeFile(join(project, 'other.txt'), 'x\n') : undefined)
    expect(await mergeBranch(deps(), id, applyOnly)).toEqual({ code: 'applied', files: 1 })
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('branch\n')
  })

  it('最后核对之后、写到第一个文件时用户保存了第二个：第二个不覆盖，报错列出已写的第一个', async () => {
    const { id, cwd } = await branchWithCopy(false)
    await writeFile(join(cwd, 'a.txt'), 'branch a\n')
    await writeFile(join(cwd, 'b.txt'), 'branch b\n')
    fsMock.onWrite = async path => {
      if (resolve(path) !== resolve(project, 'a.txt')) return
      fsMock.onWrite = null
      await writeFile(join(project, 'b.txt'), 'user saved\n')
    }
    const error = await mergeBranch(deps(), id, applyOnly).catch((e: Error) => e)
    expect(String(error)).toContain('写到一半出错：合并期间 b.txt 又被改过了')
    expect(String(error)).toContain('已经写进去的文件：a.txt')
    expect(await readFile(join(project, 'a.txt'), 'utf8')).toBe('branch a\n')
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('user saved\n')
    expect(host.merges).toHaveLength(0)
  })

  it('最后核对之后上级会话开始运行、但没改文件：照常写完', async () => {
    const { id, cwd } = await branchWithCopy(false)
    await writeFile(join(cwd, 'b.txt'), 'branch\n')
    fsMock.onWrite = path => {
      if (resolve(path) === resolve(project, 'b.txt')) host.states.set('main', 'running')
    }
    expect(await mergeBranch(deps(), id, applyOnly)).toEqual({ code: 'applied', files: 1 })
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('branch\n')
  })

  it('勾了删副本、合并期间副本里又有改动：副本留着，起点挪到这次合并的树，下次只剩后来的改动', async () => {
    const { id, cwd } = await branchWithCopy(false)
    await writeFile(join(cwd, 'b.txt'), 'branch\n')
    fsMock.onSnapshot = n => (n === 3 ? writeFile(join(cwd, 'late.txt'), 'late\n') : undefined)
    const result = await mergeBranch(deps(), id, { ...applyOnly, removeCopy: true })
    expect(result).toMatchObject({ code: 'applied', files: 1, removeError: expect.stringContaining('副本先留着') })
    expect(await exists(cwd)).toBe(true)
    expect(host.merges.at(-1)!.patch).toMatchObject({ startCommit: expect.any(String) })
    expect(host.merges.at(-1)!.patch.copyRemoved).toBeUndefined()
    fsMock.onSnapshot = null
    expect((await branchStatus(deps(), id)).files.map(f => f.path)).toEqual(['late.txt'])
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
