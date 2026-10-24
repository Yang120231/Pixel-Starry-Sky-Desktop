// 开分支 / 合并回主会话（docs/ui/branch-merge.md）：建副本、算分支自己的改动、按文件写回上级、写摘要。
// 本机和 SSH 辅助进程共用（engine:branch* 操作表），不依赖 electron
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

async function blob(root: string, tree: string, path: string): Promise<Buffer | null> {
  const r = await runGit(root, ['cat-file', 'blob', `${tree}:${path}`], { timeout: TIMEOUT, limit: BLOB_LIMIT })
  if (r.code !== 0) return null
  return tooLarge(r.stdout, path)
}

const binary = (b: Buffer | null): boolean => !!b && b.subarray(0, 8000).includes(0)

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
  // 所以用 --show-prefix 取相对位置，不用 relative）
  const cwd = join(copy.path, prefix)
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
  /** 每个文件写回上级的内容：null 是删掉 */
  contents: Map<string, Buffer | null>
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
    files: [],
    conflicts: 0,
    canCommit: false,
    dirtyThere: [],
    running: running(d.host, id) ? 'self' : running(d.host, up.id) ? 'parent' : null,
    mergedAt: b.mergedAt,
  }
  const contents = new Map<string, Buffer | null>()
  const parentRoot = await toplevel(up.cwd).catch(() => null)
  if (parentRoot) status.parentBranch = await currentBranch(parentRoot)
  const copyRoot = b.copyId ? await copyRootOf(d, record) : null
  status.copyExists = !b.copyId || !!copyRoot
  if (!copyRoot || !parentRoot || !b.startCommit) return { status, copyRoot, parentRoot, endTree: null, contents }

  const start = b.startCommit
  const endTree = await snapshotTree(copyRoot)
  const [nameStatus, numstat] = await Promise.all([
    git(copyRoot, ['diff', '--no-renames', '--name-status', '-z', start, endTree]),
    git(copyRoot, ['diff', '--no-renames', '--numstat', '-z', start, endTree]),
  ])
  const counts = new Map<string, { a: number | null; d: number | null }>()
  for (const entry of numstat.toString('utf8').split('\0').filter(Boolean)) {
    const [a, del, ...rest] = entry.split('\t')
    counts.set(rest.join('\t'), { a: a === '-' ? null : Number(a), d: del === '-' ? null : Number(del) })
  }
  const parts = nameStatus.toString('utf8').split('\0').filter(Boolean)
  const touched: { path: string; status: BranchFile['status'] }[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i][0]
    touched.push({ path: parts[i + 1], status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified' })
  }
  if (!touched.length) return { status, copyRoot, parentRoot, endTree, contents }

  const parentTree = await snapshotTree(parentRoot)
  const [changedThere, dirtyThere] = await Promise.all([
    names(parentRoot, ['diff', '--no-renames', '--name-only', '-z', start, parentTree]),
    names(parentRoot, ['diff', '--no-renames', '--name-only', '-z', 'HEAD', parentTree]).catch(() => new Set<string>()),
  ])
  for (const t of touched) {
    const c = counts.get(t.path)
    const file: BranchFile = { ...t, additions: c?.a ?? null, deletions: c?.d ?? null, merge: 'replace' }
    if (!changedThere.has(t.path)) {
      if (withContents) contents.set(t.path, t.status === 'deleted' ? null : await blob(copyRoot, endTree, t.path))
    } else {
      // 上级里这个文件开分支之后又改过：三方合并（上级现在的 / 起点 / 分支的）
      const [ours, base, theirs] = await Promise.all([
        blob(parentRoot, parentTree, t.path),
        blob(parentRoot, start, t.path),
        blob(copyRoot, endTree, t.path),
      ])
      // 两边都删了：没有冲突
      if (theirs === null && ours === null) {
        file.merge = 'auto'
        if (withContents) contents.set(t.path, null)
      } else if (theirs === null) Object.assign(file, { merge: 'conflict', reason: 'deleted' })
      else if (ours === null) Object.assign(file, { merge: 'conflict', reason: 'removedThere' })
      else if (ours.equals(theirs)) {
        file.merge = 'auto'
        if (withContents) contents.set(t.path, theirs)
      } else if (base === null) Object.assign(file, { merge: 'conflict', reason: 'addedBoth' })
      else if (binary(ours) || binary(base) || binary(theirs))
        Object.assign(file, { merge: 'conflict', reason: 'binary' })
      else {
        const merged = await mergeText(parentRoot, t.path, ours, base, theirs)
        if (merged) {
          file.merge = 'auto'
          if (withContents) contents.set(t.path, merged)
        } else Object.assign(file, { merge: 'conflict', reason: 'conflict' })
      }
    }
    status.files.push(file)
  }
  status.conflicts = status.files.filter(f => f.merge === 'conflict').length
  status.dirtyThere = status.files.filter(f => dirtyThere.has(f.path)).map(f => f.path)
  status.canCommit = status.conflicts === 0 && status.dirtyThere.length === 0
  return { status, copyRoot, parentRoot, endTree, contents }
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

/** 只提交这些文件：路径写进临时文件给 git（Windows 命令行长度有限），按字面匹配（文件名里的 * ? 不当通配符） */
async function commitPaths(root: string, files: string[], message: string): Promise<boolean> {
  // 只交写完之后和 HEAD 真不一样的：两边都删了、上级已经提交过同样内容的不算（给 git 一个不存在的路径会报错）
  const changed = await names(root, ['diff', '--no-renames', '--name-only', '-z', 'HEAD', await snapshotTree(root)])
  const paths = files.filter(p => changed.has(p))
  if (!paths.length) return false
  const dir = await mkdtemp(join(tmpdir(), 'pixelsky-commit-'))
  try {
    const list = join(dir, 'paths')
    await writeFile(list, paths.join('\0'))
    const env = { GIT_LITERAL_PATHSPECS: '1' }
    const from = [`--pathspec-from-file=${list}`, '--pathspec-file-nul']
    await git(root, ['add', '-A', ...from], { env })
    await git(root, ['commit', '-q', '-F', '-', ...from], { env, input: message })
    return true
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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
  // 同目录：代码本来就在上级目录里；副本里没改动：没有要合并的
  let code: BranchMergeResult['code'] =
    status.mode === 'shared' || !files.length ? 'none' : opts.code ? 'applied' : 'skipped'
  let commitError: string | undefined
  let message = ''
  if (opts.code && files.length) {
    if (!p.parentRoot || !p.copyRoot || !p.endTree) throw new Error('副本已经不在了，代码没法合并')
    if (status.conflicts) throw new Error('有文件合不上，先处理冲突或者只合并对话')
    if (opts.code.commit && !status.canCommit) throw new Error('这些文件在上级目录里有没提交的改动，不能直接提交')
    for (const f of files) {
      const target = join(p.parentRoot, f.path)
      if (!inside(p.parentRoot, target)) throw new Error('路径不正确：' + f.path)
      const content = p.contents.get(f.path)
      if (content === undefined) throw new Error('没算出要写的内容：' + f.path)
      if (content === null) await rm(target, { force: true })
      else {
        await mkdir(resolve(target, '..'), { recursive: true })
        await writeFile(target, content)
      }
    }
    if (opts.code.commit) {
      message = opts.code.message.trim() || `合并分支「${record.title}」`
      try {
        // 写完之后和上级的 HEAD 没有不同：没有要提交的，算放进了工作区
        if (
          await commitPaths(
            p.parentRoot,
            files.map(f => f.path),
            message,
          )
        )
          code = 'committed'
      } catch (error) {
        commitError = (error as Error).message
      }
    }
  }
  // 副本留着、以后再合并：起点挪到这次合并用的树（§5.3）
  const branchPatch: Parameters<EngineHost['recordMerge']>[2] = {}
  let removeError: string | undefined
  let copyRemoved = false
  // 代码没合并（还有改动留在副本里）时不删副本，免得改动丢了
  if (b.copyId && p.copyRoot && opts.removeCopy && code !== 'skipped' && d.tools) {
    try {
      const copy = d.tools.copies.get(b.copyId)
      await d.tools.copies.remove(b.copyId, true)
      copyRemoved = true
      if (p.parentRoot) {
        await git(p.parentRoot, ['branch', '-D', copy.branch]).catch(() => undefined)
        await git(p.parentRoot, ['update-ref', '-d', startRef(id)]).catch(() => undefined)
      }
    } catch (error) {
      removeError = (error as Error).message
    }
  } else if (p.copyRoot && p.endTree && b.startCommit && (code === 'applied' || code === 'committed')) {
    const next = await commitTree(p.copyRoot, p.endTree, b.startCommit, `像素星空：合并到「${up.title}」`)
    await git(p.copyRoot, ['update-ref', startRef(id), next])
    branchPatch.startCommit = next
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
