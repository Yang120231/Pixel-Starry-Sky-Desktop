// 开分支 / 合并回主会话（docs/ui/branch-merge.md）：建副本、算分支自己的改动、按文件写回上级、写摘要。
// 本机和 SSH 辅助进程共用（engine:branch* 操作表），不依赖 electron
import { chmod, copyFile, lstat, mkdir, mkdtemp, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { EngineHost } from '@pixelsky/engine'
import { ENGINES, type ForkResult, type Item, type NoticeBranchMerge, type SessionRecord } from '@pixelsky/protocol'
import type {
  BranchCreateInput,
  BranchFile,
  BranchMergeOptions,
  BranchMergeResult,
  BranchPrepare,
  BranchStatus,
  BranchSummaryResult,
} from '../../../shared/types/branch'
import { isLfsPointer } from '../lfs'
import { inside, value } from '../project-tools/common'
import { runGit } from '../project-tools/git'
import type { ProjectTools } from '../project-tools/tools'

export interface BranchDeps {
  host: EngineHost
  /** 项目工具（副本）；还没初始化时为 undefined */
  tools: ProjectTools | undefined
}

const TIMEOUT = 120_000
/** 读文件内容（cat-file）时的输出上限 */
const BLOB_LIMIT = 64 * 1024 * 1024
/** 摘要的长度上限 */
export const SUMMARY_LIMIT = 8000

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

async function git(
  cwd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; input?: string; limit?: number } = {},
): Promise<Buffer> {
  const r = await runGit(cwd, args, { timeout: TIMEOUT, ...opts })
  if (r.missing) throw new Error('没有找到 git')
  if (r.timedOut) throw new Error(`git ${args[0]} 超时`)
  if (r.code !== 0) throw new Error((r.stderr.trim() || `git ${args[0]} 失败`).slice(0, 600))
  return r.stdout
}
const text = async (cwd: string, args: string[], opts?: Parameters<typeof git>[2]): Promise<string> =>
  (await git(cwd, args, opts)).toString('utf8').trim()
/** -z 输出的路径列表 */
const names = async (cwd: string, args: string[]): Promise<Set<string>> =>
  new Set((await git(cwd, args)).toString('utf8').split('\0').filter(Boolean))

async function toplevel(cwd: string): Promise<string> {
  return text(cwd, ['rev-parse', '--show-toplevel'])
}

async function currentBranch(cwd: string): Promise<string | null> {
  const name = await text(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
  return name && name !== 'HEAD' ? name : null
}

/**
 * 工作区现在的样子做成一棵树（含没提交的改动、没被忽略的新文件），不动真正的暂存区（docs/ui/branch-merge.md §3.1）：
 * 复制一份索引（带着文件状态缓存，大仓库也快）当临时索引，add -A 之后 write-tree
 */
export async function snapshotTree(root: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pixelsky-branch-'))
  const index = join(dir, 'index')
  try {
    const real = resolve(root, await text(root, ['rev-parse', '--git-path', 'index']))
    const copied = await copyFile(real, index).then(
      () => true,
      () => false,
    )
    const env = { GIT_INDEX_FILE: index }
    if (!copied)
      await git(root, ['read-tree', 'HEAD'], { env }).catch(() => git(root, ['read-tree', '--empty'], { env }))
    await git(root, ['add', '-A', '--', '.'], { env })
    return await text(root, ['write-tree'], { env })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 做「分支起点」这类提交用的身份：仓库没配时用像素星空 */
async function identity(root: string): Promise<NodeJS.ProcessEnv> {
  const get = async (key: string): Promise<string> => {
    const r = await runGit(root, ['config', '--get', key], { timeout: TIMEOUT })
    return r.code === 0 ? r.stdout.toString('utf8').trim() : ''
  }
  const [name, email] = await Promise.all([get('user.name'), get('user.email')])
  if (name && email) return {}
  return {
    GIT_AUTHOR_NAME: name || 'PixelSky',
    GIT_AUTHOR_EMAIL: email || 'pixelsky@localhost',
    GIT_COMMITTER_NAME: name || 'PixelSky',
    GIT_COMMITTER_EMAIL: email || 'pixelsky@localhost',
  }
}

async function commitTree(root: string, tree: string, parent: string, message: string): Promise<string> {
  return text(root, ['commit-tree', tree, '-p', parent, '-F', '-'], { input: message, env: await identity(root) })
}

/** 代码起点：带上没提交的改动时，工作区和 HEAD 不一样就做一个「分支起点」提交（§3.1） */
export async function startCommit(root: string, carry: boolean): Promise<string> {
  const head = await text(root, ['rev-parse', '--verify', 'HEAD'])
  if (!carry) return head
  const tree = await snapshotTree(root)
  if (tree === (await text(root, ['rev-parse', 'HEAD^{tree}']))) return head
  return commitTree(root, tree, head, '像素星空：分支起点（带上开分支时没提交的改动）')
}

/** 输出超过上限时 runGit 只截断不报错：超过的当成错误，免得把半个文件写回上级 */
function tooLarge(out: Buffer, path: string): Buffer {
  if (out.length > BLOB_LIMIT) throw new Error(`文件超过 ${BLOB_LIMIT / 1024 / 1024}MB，不能合并：${path}`)
  return out
}

/** 树里的一个条目：模式（100644 普通 / 100755 可执行 / 120000 符号链接 / 160000 子模块）和对象名 */
interface Entry {
  mode: string
  sha: string
}
const EXECUTABLE = '100755'
const SYMLINK = '120000'
const GITLINK = '160000'

interface RawChange {
  path: string
  status: BranchFile['status']
  /** 改之前 / 之后；null 是那一边没有这个文件 */
  src: Entry | null
  dst: Entry | null
}

/** 两棵树之间改过的文件，带两边的模式和对象名（diff --raw，不认改名） */
async function rawDiff(cwd: string, from: string, to: string): Promise<RawChange[]> {
  const parts = (await git(cwd, ['diff', '--no-renames', '--no-abbrev', '--raw', '-z', from, to]))
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const side = (mode: string, sha: string): Entry | null => (/^0+$/.test(mode) ? null : { mode, sha })
  const changes: RawChange[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/.exec(parts[i])
    if (!m) throw new Error('读不懂 git diff 的输出')
    changes.push({
      path: parts[i + 1],
      status: m[5] === 'A' ? 'added' : m[5] === 'D' ? 'deleted' : 'modified',
      src: side(m[1], m[3]),
      dst: side(m[2], m[4]),
    })
  }
  return changes
}

/** Git 里的内容（规范化的：LFS 是指针、换行是提交时的样子）；读不出来直接报错，不当成「没有这个文件」 */
async function blob(root: string, sha: string, path: string): Promise<Buffer> {
  return tooLarge(await git(root, ['cat-file', 'blob', sha], { limit: BLOB_LIMIT }), path)
}

/** 三方合并的结果存进对象库，拿到对象名（不过 clean 过滤：它本来就是规范化内容） */
async function storeBlob(root: string, data: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pixelsky-merge-'))
  try {
    const file = join(dir, 'blob')
    await writeFile(file, data)
    return await text(root, ['hash-object', '-w', '--no-filters', '--', file])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 写盘用的内容：按上级目录的 .gitattributes 和配置转成检出的样子（LFS 指针换成文件、换行按 autocrlf / eol）。
 * 没装 git-lfs（或跳过了下载）时 git 会原样给出指针：宁可不合并，也不拿指针盖掉上级里的真文件
 */
async function checkout(root: string, path: string, sha: string): Promise<Buffer> {
  const out = tooLarge(await git(root, ['cat-file', '--filters', `--path=${path}`, sha], { limit: BLOB_LIMIT }), path)
  if (isLfsPointer(out) && (await text(root, ['check-attr', 'filter', '--', path])).endsWith(': lfs'))
    throw new Error(`没能把 Git LFS 指针换成文件内容（可能没装 git-lfs），不能合并：${path}`)
  return out
}

const binary = (b: Buffer): boolean => b.subarray(0, 8000).includes(0)

/** 三方合并一个文本文件：合得上返回结果，有冲突返回 null */
async function mergeText(
  root: string,
  path: string,
  ours: Buffer,
  base: Buffer,
  theirs: Buffer,
): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'pixelsky-merge-'))
  try {
    const files = ['ours', 'base', 'theirs'].map(n => join(dir, n))
    await Promise.all([writeFile(files[0], ours), writeFile(files[1], base), writeFile(files[2], theirs)])
    const r = await runGit(root, ['merge-file', '-p', ...files], { timeout: TIMEOUT, limit: BLOB_LIMIT })
    return r.code === 0 ? tooLarge(r.stdout, path) : null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 开分支
// ---------------------------------------------------------------------------

function sessionRecord(host: EngineHost, id: string): SessionRecord {
  const record = host.record(id)
  if (!record) throw new Error('会话不存在')
  return record
}

function running(host: EngineHost, id: string): boolean {
  const s = host.sessions().find(x => x.record.id === id)
  return !!s && s.state !== 'idle'
}

export async function prepareBranch(d: BranchDeps, id: string): Promise<BranchPrepare> {
  const record = sessionRecord(d.host, id)
  const root = await toplevel(record.cwd).catch(() => null)
  if (!root) return { git: false, baseBranch: null, dirty: 0, copyRoot: null, branches: [], copies: [] }
  const [baseBranch, status, branches] = await Promise.all([
    currentBranch(root),
    git(root, ['status', '--porcelain', '-z', '--untracked-files=all']).catch(() => Buffer.alloc(0)),
    text(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).catch(() => ''),
  ])
  // -z 输出里改名的条目后面多一个原路径
  const entries = status.toString('utf8').split('\0').filter(Boolean)
  let dirty = 0
  for (let i = 0; i < entries.length; i++) {
    dirty++
    if (/^[RC]/.test(entries[i])) i++
  }
  const copies = d.tools?.copies.store.data.copies.filter(c => c.projectId === record.projectId) ?? []
  let copyRoot: string | null = null
  if (d.tools) {
    try {
      const preview = await d.tools.copies.preview(record.projectId, {
        name: 'x',
        branch: 'pixelsky/branch-preview-' + Date.now(),
        existingBranch: false,
        base: 'HEAD',
      })
      copyRoot = resolve(preview.path, '..')
    } catch {
      copyRoot = null
    }
  }
  return {
    git: true,
    baseBranch,
    dirty,
    copyRoot,
    branches: branches.split('\n').filter(Boolean),
    copies: copies.map(c => c.name),
  }
}

/** 开分支（§3）：建副本（可选）再分叉；会话没开成就把副本和分支删掉 */
export async function createBranch(
  d: BranchDeps,
  id: string,
  itemId: string | null,
  raw: BranchCreateInput,
): Promise<ForkResult> {
  const record = sessionRecord(d.host, id)
  if (!ENGINES[record.engine].caps.fork) throw new Error('当前引擎暂不支持开分支')
  if (record.branch?.copyRemoved) throw new Error('这个分支的副本已经删掉，不能再开分支')
  const input = (raw ?? {}) as BranchCreateInput
  const title = value(input.title, 200, true)
  const root = await toplevel(record.cwd).catch(() => null)
  const baseBranch = root ? await currentBranch(root) : null
  if (!input.copy)
    return d.host.forkSession(id, itemId, title, {
      branch: { copyId: null, gitBranch: null, baseBranch, startCommit: null },
    })
  if (!root) throw new Error('工作目录不是 Git 仓库，不能建副本')
  if (!d.tools) throw new Error('项目工具还没准备好，请稍后再试')
  const name = value(input.copy.name, 80, true)
  const branch = value(input.copy.branch, 150, true)
  // 整个会话开分支时会话要空闲（引擎里也会再查一次）；先查，免得白建副本
  if (itemId === null && running(d.host, id)) throw new Error('AI 正在回复，等它说完再开分支')
  const start = await startCommit(root, input.copy.carry === true)
  const prefix = await text(record.cwd, ['rev-parse', '--show-prefix'])
  const copy = await d.tools.copies.create(record.projectId, { name, branch, existingBranch: false, base: start })
  // 项目是仓库里的子文件夹时，会话的工作目录也是副本里对应的子文件夹（toplevel 是解析过链接的真实路径，
  // 所以用 --show-prefix 取相对位置，不用 relative）。prefix 带结尾的「/」，join 会留着它，
  // 引擎按工作目录找会话记录时（Claude 的项目文件夹编码）就多一个「-」，所以用 resolve 去掉
  const cwd = prefix ? resolve(copy.path, prefix) : copy.path
  try {
    return await d.host.forkSession(id, itemId, title, {
      cwd,
      branch: { copyId: copy.id, gitBranch: copy.branch, baseBranch, startCommit: start },
    })
  } catch (error) {
    await d.tools.copies.remove(copy.id, true).catch(() => undefined)
    await git(root, ['branch', '-D', copy.branch]).catch(() => undefined)
    throw error
  }
}

// ---------------------------------------------------------------------------
// 合并
// ---------------------------------------------------------------------------

interface Plan {
  status: BranchStatus
  /** 分支会话和上级的仓库根目录、分支现在的树 */
  copyRoot: string | null
  parentRoot: string | null
  endTree: string | null
  /** 算合并时上级目录的快照：写之前核对要写的文件没再改过 */
  parentTree: string | null
  /** 每个文件写回上级的内容：null 是删掉 */
  contents: Map<string, Write | null>
}

/**
 * 写回上级的一个文件：模式 + Git 里的对象（直接换上的）或三方合并的结果（data，规范化内容，sha 为 null）。
 * 写盘前再转成检出的样子（checkout）
 */
interface Write {
  mode: string
  sha: string | null
  data: Buffer | null
}

/** 三方合并模式（权限、文件 / 符号链接）：两边一样或只有一边改过时取改过的，两边改得不一样返回 null */
function mergeMode(ours: string, base: string | undefined, theirs: string): string | null {
  if (ours === theirs) return ours
  if (ours === base) return theirs
  if (theirs === base) return ours
  return null
}

function parent(d: BranchDeps, record: SessionRecord): SessionRecord {
  if (!record.branch || !record.forkedFrom) throw new Error('这个会话不是开分支开出来的')
  const p = d.host.record(record.forkedFrom.sessionId)
  if (!p) throw new Error('上级会话已经不在了，不能合并')
  return p
}

async function copyRootOf(d: BranchDeps, record: SessionRecord): Promise<string | null> {
  const copyId = record.branch?.copyId
  if (!copyId || record.branch?.copyRemoved || !d.tools) return null
  try {
    const copy = d.tools.copies.get(copyId)
    await d.tools.copies.verify(copy)
    return copy.path
  } catch {
    return null
  }
}

/** 算分支自己的改动和写回上级的办法（§5.1）；withContents 时把要写的内容也算好 */
async function plan(d: BranchDeps, id: string, withContents: boolean): Promise<Plan> {
  const record = sessionRecord(d.host, id)
  const up = parent(d, record)
  const b = record.branch!
  const status: BranchStatus = {
    mode: b.copyId ? 'copy' : 'shared',
    parentId: up.id,
    parentTitle: up.title,
    parentIsBranch: !!up.branch && !!up.forkedFrom && !!d.host.record(up.forkedFrom.sessionId),
    gitBranch: b.gitBranch,
    parentBranch: null,
    copyExists: !b.copyId,
    codeUnknown: false,
    files: [],
    conflicts: 0,
    canCommit: false,
    dirtyThere: [],
    running: running(d.host, id) ? 'self' : running(d.host, up.id) ? 'parent' : null,
    mergedAt: b.mergedAt,
  }
  const contents = new Map<string, Write | null>()
  const parentRoot = await toplevel(up.cwd).catch(() => null)
  if (parentRoot) status.parentBranch = await currentBranch(parentRoot)
  const copyRoot = b.copyId ? await copyRootOf(d, record) : null
  status.copyExists = !b.copyId || !!copyRoot
  if (!copyRoot || !parentRoot || !b.startCommit) {
    // 副本在却算不出改动：不能当成「没有代码改动」（那样会放行删副本，副本里的改动就没了）
    status.codeUnknown = !!copyRoot
    return { status, copyRoot, parentRoot, endTree: null, parentTree: null, contents }
  }

  const start = b.startCommit
  const endTree = await snapshotTree(copyRoot)
  const [touched, numstat] = await Promise.all([
    rawDiff(copyRoot, start, endTree),
    git(copyRoot, ['diff', '--no-renames', '--numstat', '-z', start, endTree]),
  ])
  const counts = new Map<string, { a: number | null; d: number | null }>()
  for (const entry of numstat.toString('utf8').split('\0').filter(Boolean)) {
    const [a, del, ...rest] = entry.split('\t')
    counts.set(rest.join('\t'), { a: a === '-' ? null : Number(a), d: del === '-' ? null : Number(del) })
  }
  if (!touched.length) return { status, copyRoot, parentRoot, endTree, parentTree: null, contents }

  const parentTree = await snapshotTree(parentRoot)
  const [changedThere, dirtyThere] = await Promise.all([
    rawDiff(parentRoot, start, parentTree).then(list => new Map(list.map(c => [c.path, c.dst]))),
    names(parentRoot, ['diff', '--no-renames', '--name-only', '-z', 'HEAD', parentTree]).catch(() => new Set<string>()),
  ])
  for (const t of touched) {
    const c = counts.get(t.path)
    const file: BranchFile = {
      path: t.path,
      status: t.status,
      additions: c?.a ?? null,
      deletions: c?.d ?? null,
      merge: 'replace',
    }
    // 起点 / 分支的 / 上级现在的（上级没改过时和起点一样）
    const base = t.src,
      theirs = t.dst,
      ours = changedThere.has(t.path) ? changedThere.get(t.path)! : base
    const conflict = (reason: NonNullable<BranchFile['reason']>): void => {
      file.merge = 'conflict'
      file.reason = reason
    }
    const take = (write: Write | null): void => {
      if (withContents) contents.set(t.path, write)
    }
    // 子模块（gitlink）没有文件内容可写：任何一边涉及子模块都不自动处理
    if ([base, theirs, ours].some(e => e?.mode === GITLINK)) conflict('submodule')
    else if (!changedThere.has(t.path)) take(theirs && { mode: theirs.mode, sha: theirs.sha, data: null })
    else {
      // 上级里这个文件开分支之后又改过：三方合并（上级现在的 / 起点 / 分支的）
      file.merge = 'auto'
      const mode = ours && theirs ? mergeMode(ours.mode, base?.mode, theirs.mode) : null
      // 两边都删了：没有冲突
      if (!theirs && !ours) take(null)
      else if (!theirs) conflict('deleted')
      else if (!ours) conflict('removedThere')
      // 两边把权限或类型（文件 / 符号链接）改得不一样
      else if (!mode) conflict('conflict')
      else if (ours.sha === theirs.sha) take({ mode, sha: theirs.sha, data: null })
      else if (!base) conflict('addedBoth')
      // 内容只有一边改过（另一边只改了权限）
      else if (ours.sha === base.sha) take({ mode, sha: theirs.sha, data: null })
      else if (theirs.sha === base.sha) take({ mode, sha: ours.sha, data: null })
      // 符号链接的目标两边都改了：不拿链接目标做文本合并
      else if ([ours, base, theirs].some(e => e.mode === SYMLINK)) conflict('conflict')
      else {
        const [o, s, h] = await Promise.all([
          blob(parentRoot, ours.sha, t.path),
          blob(parentRoot, base.sha, t.path),
          blob(parentRoot, theirs.sha, t.path),
        ])
        if (binary(o) || binary(s) || binary(h)) conflict('binary')
        else {
          const merged = await mergeText(parentRoot, t.path, o, s, h)
          if (merged) take({ mode, sha: null, data: merged })
          else conflict('conflict')
        }
      }
    }
    status.files.push(file)
  }
  status.conflicts = status.files.filter(f => f.merge === 'conflict').length
  status.dirtyThere = status.files.filter(f => dirtyThere.has(f.path)).map(f => f.path)
  status.canCommit = status.conflicts === 0 && status.dirtyThere.length === 0
  return { status, copyRoot, parentRoot, endTree, parentTree, contents }
}

export async function branchStatus(d: BranchDeps, id: string): Promise<BranchStatus> {
  return (await plan(d, id, false)).status
}

function mergeOptions(raw: unknown): BranchMergeOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  const code = o.code && typeof o.code === 'object' ? (o.code as Record<string, unknown>) : null
  const summary = typeof o.summary === 'string' ? o.summary.trim().slice(0, SUMMARY_LIMIT) : ''
  return {
    code: code ? { commit: code.commit === true, message: typeof code.message === 'string' ? code.message : '' } : null,
    removeCopy: o.removeCopy === true,
    summary: summary || null,
  }
}

/** 做成了没有（失败不报错） */
const succeeded = (p: Promise<unknown>): Promise<boolean> =>
  p.then(
    () => true,
    () => false,
  )

/** 提交里的一个文件：写回后的模式和对象名（规范化内容）；entry 为 null 是删掉 */
export interface CommitEntry {
  path: string
  entry: Entry | null
}

/**
 * 只提交写回的这些文件（§5.2）。不用 `git add` + `git commit -- 路径`：那样按工作区重新认文件，
 * 不分大小写的磁盘上只改大小写的改名（Readme.md → README.md）认不出来、提交时还会报错，
 * core.symlinks=false 时写成文本的符号链接、core.fileMode=false 时的可执行位也会按普通文件提交。
 * 这里直接按算好的模式和对象名拼提交：临时索引 = HEAD（借真索引的文件状态缓存，大仓库也快）+ 这些文件，
 * 用它 git commit（钩子、签名照常）；提交之后真索引里这些文件也换成提交的样子，别的暂存改动不动。
 * 写完之后和 HEAD 没有不同时不提交，返回 false
 */
export async function commitPaths(root: string, entries: CommitEntry[], message: string): Promise<boolean> {
  if (!entries.length) return false
  const head = await text(root, ['rev-parse', '--verify', 'HEAD'])
  // 删除写在前面（只改大小写的改名先删旧名再加新名）；对象名长度跟着仓库（sha1 / sha256）
  const zero = '0'.repeat(head.length)
  const info =
    [...entries]
      .sort((a, b) => Number(!!a.entry) - Number(!!b.entry))
      .map(e => (e.entry ? `${e.entry.mode} ${e.entry.sha}\t${e.path}` : `0 ${zero}\t${e.path}`))
      .join('\0') + '\0'
  const dir = await mkdtemp(join(tmpdir(), 'pixelsky-commit-'))
  try {
    const index = join(dir, 'index')
    const env = { GIT_INDEX_FILE: index }
    const real = resolve(root, await text(root, ['rev-parse', '--git-path', 'index']))
    // 单棵树的 read-tree -m：和真索引内容一样的条目留着文件状态缓存（commit 刷新索引时不用把整个仓库重读一遍）
    const copied = await succeeded(copyFile(real, index))
    if (!copied || !(await succeeded(git(root, ['read-tree', '-m', 'HEAD'], { env }))))
      await git(root, ['read-tree', 'HEAD'], { env })
    await git(root, ['update-index', '-z', '--index-info'], { env, input: info })
    if ((await text(root, ['write-tree'], { env })) === (await text(root, ['rev-parse', 'HEAD^{tree}']))) return false
    await git(root, ['commit', '-q', '-F', '-'], { env, input: message })
    // 真索引：这些文件换成提交的样子（和 git commit -- 路径一样）；没换成只是 git status 里显示成暂存的改动，提交已经成了
    await git(root, ['update-index', '-z', '--index-info'], { input: info }).catch(() => undefined)
    return true
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 写回上级的目标：在上级目录里，途经的文件夹都不是符号链接（不然会写到链接指向的地方，甚至仓库外） */
async function safeTarget(root: string, path: string): Promise<string> {
  const target = join(root, path)
  if (!path || !inside(root, target) || resolve(target) === resolve(root)) throw new Error('路径不正确：' + path)
  let dir = root
  for (const part of path.split('/').slice(0, -1)) {
    dir = join(dir, part)
    const info = await lstat(dir).catch(() => null)
    if (!info) break
    if (info.isSymbolicLink()) throw new Error('路径里有符号链接，不能写：' + path)
  }
  return target
}

/** 删掉上级里的一个文件（是符号链接时删链接本身），再把删空的文件夹也删掉（和 git 一样），不越过上级目录 */
async function removeFile(root: string, path: string): Promise<void> {
  const target = await safeTarget(root, path)
  await rm(target, { force: true })
  for (let dir = dirname(target); inside(root, dir) && resolve(dir) !== resolve(root); dir = dirname(dir)) {
    // 不空（或删不了）就停
    if (!(await succeeded(rmdir(dir)))) break
  }
}

interface Prepared {
  path: string
  mode: string
  /** 检出形式的内容；符号链接是链接目标 */
  data: Buffer
}

/** 建符号链接失败时，这些错误是「这里建不了链接」（Windows 没开开发者模式、文件系统不支持），退回写成文本；别的照样报错 */
const NO_SYMLINKS = new Set(['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'])

/**
 * 写一个文件：原来是符号链接先删链接（不写到链接指向的地方）；原来是（删空了的）文件夹先删掉；
 * 要建符号链接而原来是普通文件时也先删掉（symlink 不会覆盖）。符号链接、可执行位按 Git 里的模式
 */
async function writeOne(root: string, w: Prepared, symlinks: boolean): Promise<void> {
  const target = await safeTarget(root, w.path)
  await mkdir(dirname(target), { recursive: true })
  const info = await lstat(target).catch(() => null)
  // 文件夹不空时 rmdir 报错，不会删掉别的东西
  if (info?.isDirectory()) await rmdir(target)
  else if (info && (info.isSymbolicLink() || w.mode === SYMLINK)) await rm(target)
  if (w.mode === SYMLINK) {
    // 建不了链接或仓库设了 core.symlinks=false：和 git 一样写成内容是链接目标的文本文件
    if (symlinks) {
      try {
        await symlink(w.data, target)
        return
      } catch (error) {
        if (!NO_SYMLINKS.has((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
    await writeFile(target, w.data)
    return
  }
  await writeFile(target, w.data)
  // 可执行位（Windows 没有）：按 Git 里的模式加上或去掉，和读权限对应。存不了权限的文件系统
  // （vfat / exFAT U 盘、部分网络盘，git 在那里设 core.fileMode=false）chmod 会报错：尽量设，设不上不算失败
  if (process.platform === 'win32') return
  const current = (await stat(target)).mode & 0o777
  const next = w.mode === EXECUTABLE ? current | ((current & 0o444) >> 2) : current & ~0o111
  if (next !== current) await chmod(target, next).catch(() => undefined)
}

/**
 * 把算好的内容写进上级目录（§5.1）。先全部准备好（转成检出形式、检查路径），准备时出错一个都不写；
 * 然后先删后写：只改大小写的改名（Readme.md → README.md）在不分大小写的磁盘上先写后删会把文件删掉，
 * 文件夹换成同名文件（lib/ → lib）也要先把文件夹删空。写到一半出错时列出已经写了的文件。
 * 返回每个文件写进去的模式和对象名，压成一个提交时照着它提交（commitPaths）
 */
async function writeBack(
  root: string,
  paths: string[],
  contents: Map<string, Write | null>,
  ready: () => Promise<void>,
): Promise<CommitEntry[]> {
  const removes: string[] = [],
    writes: Prepared[] = [],
    entries: CommitEntry[] = []
  for (const path of paths) {
    const content = contents.get(path)
    if (content === undefined) throw new Error('没算出要写的内容：' + path)
    await safeTarget(root, path)
    if (content === null) {
      removes.push(path)
      entries.push({ path, entry: null })
      continue
    }
    // 三方合并的结果先存成对象，再和直接换上的文件一样按上级的 .gitattributes 转换；符号链接写的是链接目标本身
    const sha = content.sha ?? (await storeBlob(root, content.data!))
    entries.push({ path, entry: { mode: content.mode, sha } })
    const data = content.mode === SYMLINK ? await blob(root, sha, path) : await checkout(root, path, sha)
    writes.push({ path, mode: content.mode, data })
  }
  const setting = writes.some(w => w.mode === SYMLINK)
    ? await text(root, ['config', '--type=bool', 'core.symlinks']).catch(() => '')
    : ''
  const symlinks = setting ? setting === 'true' : process.platform !== 'win32'
  // 都准备好了、真正动文件之前最后核对一次（报错时一个都没写）
  await ready()
  const done: string[] = []
  try {
    for (const path of removes) {
      await removeFile(root, path)
      done.push(path)
    }
    for (const w of writes) {
      await writeOne(root, w, symlinks)
      done.push(w.path)
    }
  } catch (error) {
    if (!done.length) throw error
    const list = done.length > 20 ? `${done.slice(0, 20).join('、')} 等 ${done.length} 个` : done.join('、')
    throw new Error(`写到一半出错：${(error as Error).message}。已经写进去的文件：${list}`)
  }
  return entries
}

/** 副本留着时挪过的代码起点没有分支指着，挂一个引用，免得被 git gc 清掉 */
const startRef = (sessionId: string): string => `refs/pixelsky/branch-start/${sessionId}`

/** 合并回上级（§5）：先把要写的都算好，有冲突一个都不写 */
export async function mergeBranch(d: BranchDeps, id: string, raw: unknown): Promise<BranchMergeResult> {
  const opts = mergeOptions(raw)
  const record = sessionRecord(d.host, id)
  const up = parent(d, record)
  const b = record.branch!
  if (!opts.code && !opts.summary) throw new Error('代码和对话至少合并一样')
  const p = await plan(d, id, !!opts.code)
  const { status } = p
  if (status.running === 'self') throw new Error('分支会话正在运行，等它停下再合并')
  if (status.running === 'parent') throw new Error('上级会话正在运行，等它停下再合并')
  const files = status.files
  // 副本在却算不出改动（找不到上级的仓库）：代码不能合并，改动还在副本里
  if (opts.code && status.codeUnknown) throw new Error('找不到上级目录的 Git 仓库，算不出副本里的改动，代码没法合并')
  // 同目录：代码本来就在上级目录里；副本里没改动：没有要合并的
  let code: BranchMergeResult['code'] = status.codeUnknown
    ? 'skipped'
    : status.mode === 'shared' || !files.length
      ? 'none'
      : opts.code
        ? 'applied'
        : 'skipped'
  let commitError: string | undefined
  let message = ''
  if (opts.code && files.length) {
    if (!p.parentRoot || !p.copyRoot || !p.endTree || !p.parentTree) throw new Error('副本已经不在了，代码没法合并')
    if (status.conflicts) throw new Error('有文件合不上，先处理冲突或者只合并对话')
    if (opts.code.commit && !status.canCommit) throw new Error('这些文件在上级目录里有没提交的改动，不能直接提交')
    const root = p.parentRoot,
      before = p.parentTree,
      paths = files.map(f => f.path)
    // 算合并花了一阵：期间要写的文件被改过（AI、编辑器、终端）或会话开始运行，这次不写。运行状态最后查，紧挨着写
    const entries = await writeBack(root, paths, p.contents, async () => {
      const now = await snapshotTree(root)
      if (now !== before) {
        const moved = await names(root, ['diff', '--no-renames', '--name-only', '-z', before, now])
        if (paths.some(path => moved.has(path))) throw new Error('合并期间上级目录里要写的文件又改过了，重新合并一次')
      }
      if (running(d.host, id)) throw new Error('分支会话正在运行，等它停下再合并')
      if (running(d.host, up.id)) throw new Error('上级会话正在运行，等它停下再合并')
    })
    if (opts.code.commit) {
      message = opts.code.message.trim() || `合并分支「${record.title}」`
      try {
        // 写完之后和上级的 HEAD 没有不同：没有要提交的，算放进了工作区
        if (await commitPaths(p.parentRoot, entries, message)) code = 'committed'
      } catch (error) {
        commitError = (error as Error).message
      }
    }
  }
  // 合并之后记到分支上的：副本删了没有、挪过的代码起点（§5.3）
  const branchPatch: Parameters<EngineHost['recordMerge']>[2] = {}
  let removeError: string | undefined
  let copyRemoved = false
  // 代码没合并（还有改动留在副本里）时不删副本，免得改动丢了；只有真算出了改动（有上级的仓库和分支的树）才删
  if (
    b.copyId &&
    p.copyRoot &&
    p.parentRoot &&
    p.endTree &&
    !status.codeUnknown &&
    opts.removeCopy &&
    code !== 'skipped' &&
    d.tools
  ) {
    try {
      // 合并期间分支又改了副本或又开始跑：强制删会丢掉后来的改动，副本留着（起点照常挪到这次合并的树）
      if ((await snapshotTree(p.copyRoot)) !== p.endTree || running(d.host, id))
        throw new Error('分支在合并期间又有改动，副本先留着')
      const copy = d.tools.copies.get(b.copyId)
      await d.tools.copies.remove(b.copyId, true)
      copyRemoved = true
      await git(p.parentRoot, ['branch', '-D', copy.branch]).catch(() => undefined)
      await git(p.parentRoot, ['update-ref', '-d', startRef(id)]).catch(() => undefined)
    } catch (error) {
      removeError = (error as Error).message
    }
  }
  // 副本留着（没要删或没删掉）：起点挪到这次合并用的树。在上级目录里做（同一个对象库和引用），
  // 副本删到一半时也做得成；挪不成也不影响这次合并（下次再合并时这些改动两边一样，会自动合上）
  if (!copyRemoved && p.parentRoot && p.endTree && b.startCommit && (code === 'applied' || code === 'committed')) {
    try {
      const next = await commitTree(p.parentRoot, p.endTree, b.startCommit, `像素星空：合并到「${up.title}」`)
      await git(p.parentRoot, ['update-ref', startRef(id), next])
      branchPatch.startCommit = next
    } catch {
      /* 起点没挪 */
    }
  }
  if (copyRemoved) branchPatch.copyRemoved = true
  const notice: NoticeBranchMerge = {
    sessionId: id,
    title: record.title,
    summary: opts.summary,
    code,
    ...(code === 'committed' ? { commitMessage: message } : {}),
    files: files.map(f => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions })),
    copyRemoved,
    gitBranch: b.gitBranch,
  }
  d.host.recordMerge(id, notice, branchPatch)
  return {
    code,
    files: files.length,
    ...(commitError ? { commitError } : {}),
    ...(removeError ? { removeError } : {}),
  }
}

// ---------------------------------------------------------------------------
// 摘要
// ---------------------------------------------------------------------------

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s)

/** 分支里说过的话和改过的文件，整理成给 AI 看的材料（太长时留后面的） */
function digest(items: Item[]): { lines: string[]; asks: string[]; paths: string[] } {
  const lines: string[] = [],
    asks: string[] = [],
    paths = new Set<string>()
  for (const item of items) {
    if (item.kind === 'user' && item.text.trim()) {
      asks.push(item.text.trim())
      lines.push('用户：' + cut(item.text.trim(), 1500))
    } else if (item.kind === 'assistant' && item.text.trim()) lines.push('AI：' + cut(item.text.trim(), 1500))
    else if (item.kind === 'file_change') for (const c of item.changes) paths.add(c.path)
  }
  let total = 0,
    from = lines.length
  while (from > 0 && total + lines[from - 1].length < 24_000) total += lines[--from].length
  return { lines: lines.slice(from), asks, paths: [...paths] }
}

const base = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function draftSummary(asks: string[], files: string[], language: 'zh' | 'en'): string {
  const zh = language === 'zh'
  const done = asks.slice(0, 6).map(a => (zh ? `· 按「${cut(a, 40)}」做了调整` : `· Worked on: "${cut(a, 60)}"`))
  if (!done.length) done.push(zh ? '· 分支里还没有新的对话' : '· No new conversation in the branch yet')
  const notes = files.length
    ? [
        zh
          ? `· 改了 ${files.length} 个文件：${files.slice(0, 8).map(base).join('、')}`
          : `· Changed ${files.length} files: ${files.slice(0, 8).map(base).join(', ')}`,
      ]
    : [zh ? '· 没有代码改动' : '· No code changes']
  return [
    zh ? '分支里做了什么' : 'What the branch did',
    ...done,
    zh ? '结论和注意' : 'Conclusions and caveats',
    ...notes,
  ].join('\n')
}

function summaryPrompt(title: string, lines: string[], files: string[], language: 'zh' | 'en'): string {
  const zh = language === 'zh'
  const head = zh
    ? `下面是分支会话「${title}」里的对话。请写一段合并摘要，交给主会话的 AI 接着用。要求：
- 只用中文，纯文本，不要 Markdown 标题、代码块或加粗。
- 两段，各一行标题：「分支里做了什么」「结论和注意」；每段下面若干条，每条以「· 」开头，一条一句话。
- 写清楚最后采用的做法、改了哪些关键文件、还没做完或要注意的地方；不要复述过程中被放弃的尝试。
- 一共不超过 12 条。只输出摘要本身。`
    : `Below is the conversation from the branch session "${title}". Write a merge summary for the AI in the main session to continue from. Rules:
- Plain text in English, no Markdown headings, code blocks or bold.
- Two sections, each with a one-line heading: "What the branch did" and "Conclusions and caveats"; under each, items starting with "· ", one sentence each.
- State the approach finally taken, key files changed, and what is unfinished or needs care; skip abandoned attempts.
- At most 12 items in total. Output only the summary.`
  const changed = files.length
    ? (zh ? '\n\n改动的文件：\n' : '\n\nChanged files:\n') + files.slice(0, 60).join('\n')
    : ''
  return `${head}\n\n---\n\n${lines.join('\n\n')}${changed}`
}

/** 摘要只留纯文本：去掉代码块围栏，太长截断 */
function cleanSummary(s: string): string {
  return s
    .replace(/^```[a-z]*\s*$/gim, '')
    .trim()
    .slice(0, SUMMARY_LIMIT)
}

/** 写摘要（§5.2）：分支会话自己的引擎单独问一次；不成就用整理好的草稿 */
export async function branchSummary(d: BranchDeps, id: string, language: unknown): Promise<BranchSummaryResult> {
  const lang = language === 'en' ? 'en' : 'zh'
  const record = sessionRecord(d.host, id)
  parent(d, record)
  const { lines, asks, paths } = digest(d.host.branchItems(id))
  // 副本还在时按实际改动列文件（AI 用命令改的文件改动记录里没有）
  let files = paths
  if (record.branch?.copyId) {
    const status = await branchStatus(d, id).catch(() => null)
    if (status?.files.length) files = status.files.map(f => f.path)
  }
  const draft = draftSummary(asks, files, lang)
  if (!lines.length) return { text: draft, ai: false, problem: 'empty' }
  try {
    const reply = await d.host.oneShot(
      record.engine,
      { prompt: summaryPrompt(record.title, lines, files, lang), model: null },
      AbortSignal.timeout(90_000),
    )
    const text = cleanSummary(reply.text)
    return text ? { text, ai: true } : { text: draft, ai: false, problem: 'empty' }
  } catch (error) {
    return { text: draft, ai: false, problem: cut((error as Error).message ?? String(error), 300) }
  }
}
