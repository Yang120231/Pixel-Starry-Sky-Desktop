// Git 面板的主进程实现（docs/ui/git-panel.md）。不依赖 Electron：本机由 workspace/project-tools-ipc.ts 注入回收站，
// SSH 辅助进程注入数据目录下的 trash/（core/project-tools/trash.ts）；都不注入时用 git clean。所有命令以参数数组执行，路径前一律加 `--`。
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WorkspaceRef } from '../../../shared/types/workspace'
import type {
  GitAction,
  GitBranch,
  GitChangeSet,
  GitCommit,
  GitCommitDetail,
  GitCompareResult,
  GitDiff,
  GitDiffInput,
  GitFailure,
  GitLogPage,
  GitLogQuery,
  GitLogScope,
  GitPaths,
  GitPullMode,
  GitRefs,
  GitResult,
  GitStatus,
} from '../../../shared/types/project-tools'
import { workspacePath } from '../workspace-files'
import { value, type ToolsHost } from './common'
import {
  classifyGitError,
  isHash,
  LOG_FORMAT,
  parseCommitFiles,
  parseLog,
  parseLogNumstat,
  parseStatusV2,
} from './git-parse'
import type { TrashFile } from './trash'

export const DIFF_LIMIT = 2 * 1024 * 1024
const OUTPUT_LIMIT = 16 * 1024 * 1024
const MAX_PATHS = 5000
export const GIT_TIMEOUTS = { read: 15_000, diff: 10_000, stage: 30_000, commit: 300_000, remote: 90_000 }

/**
 * 不弹任何交互：凭据 / 编辑器 / 分页器都关掉，英文输出便于分类，状态查询不抢 index.lock，
 * 路径按字面处理（不解释 :(exclude) 之类的 pathspec 魔法）。
 */
export const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  LC_ALL: 'C',
  LANGUAGE: 'C',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_LITERAL_PATHSPECS: '1',
}

export interface GitRun {
  code: number | null
  stdout: Buffer
  stderr: string
  timedOut: boolean
  missing: boolean
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32')
      spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch {
    /* 进程已经结束 */
  }
}

/** 运行一条 git 命令；超时后结束整个进程树（凭据助手、ssh 子进程不残留） */
export function runGit(
  cwd: string,
  args: string[],
  opts: { timeout: number; input?: string; limit?: number },
): Promise<GitRun> {
  return new Promise(resolvePromise => {
    const child = spawn(
      'git',
      ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'advice.detachedHead=false', '-C', cwd, ...args],
      {
        env: { ...process.env, ...GIT_ENV },
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      },
    )
    const out: Buffer[] = [],
      limit = opts.limit ?? OUTPUT_LIMIT
    let size = 0,
      stderr = '',
      timedOut = false,
      settled = false
    const finish = (run: GitRun): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolvePromise(run)
      }
    }
    // 超时：结束整个进程树；hook 的子进程（如 sh 里的 sleep）可能仍占着输出管道，所以不再等 close，直接返回
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
      child.kill('SIGKILL')
      child.stdout!.destroy()
      child.stderr!.destroy()
      finish({ code: null, stdout: Buffer.concat(out), stderr, timedOut: true, missing: false })
    }, opts.timeout)
    child.stdout!.on('data', (chunk: Buffer) => {
      if (size <= limit) {
        out.push(chunk)
        size += chunk.length
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString('utf8')
    })
    child.on('error', error =>
      finish({
        code: null,
        stdout: Buffer.alloc(0),
        stderr: error.message,
        timedOut,
        missing: (error as NodeJS.ErrnoException).code === 'ENOENT',
      }),
    )
    child.on('close', code => finish({ code, stdout: Buffer.concat(out), stderr, timedOut, missing: false }))
    if (opts.input !== undefined) {
      child.stdin!.on('error', () => {})
      child.stdin!.end(opts.input, 'utf8')
    }
  })
}

const text = (b: Buffer): string => b.toString('utf8')
const lf = (s: string): string => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
const isBinary = (b: Buffer): boolean => b.subarray(0, 8000).includes(0)

function pathList(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAX_PATHS) throw new Error('参数不正确')
  return input.map(p => value(p, 4096, true).replace(/\\/g, '/'))
}
const paths = (input: unknown): GitPaths => (input === 'all' ? 'all' : pathList(input))

class GitError extends Error {
  constructor(readonly failure: GitFailure) {
    super(failure.detail || failure.kind)
  }
}

interface Repo {
  root: string
  prefix: string
  workspace: string
}

/** 放弃未跟踪文件时的去处：本机进系统回收站，远端移到数据目录的 trash/（docs/ui/git-panel.md §2.4）；不给则用 git clean */
export type GitTrash = (files: TrashFile[]) => Promise<void>

export class GitTools {
  private locks = new Map<string, Promise<unknown>>()
  constructor(
    private host: ToolsHost,
    private changed: () => void,
    private opts: { trash?: GitTrash; timeouts?: Partial<typeof GIT_TIMEOUTS> } = {},
  ) {}

  private timeout(kind: keyof typeof GIT_TIMEOUTS): number {
    return this.opts.timeouts?.[kind] ?? GIT_TIMEOUTS[kind]
  }

  private async repo(ref: WorkspaceRef): Promise<Repo | 'missing' | null> {
    const workspace = this.host.resolve(ref).path
    const run = await runGit(workspace, ['rev-parse', '--show-toplevel', '--show-prefix'], {
      timeout: this.timeout('read'),
    })
    if (run.missing) return 'missing'
    if (run.code !== 0) return null
    const [root = '', prefix = ''] = text(run.stdout).split(/\r?\n/)
    return { root: resolve(root.trim()), prefix: prefix.trim(), workspace }
  }

  private async exec(
    repo: Repo,
    action: GitAction,
    args: string[],
    kind: keyof typeof GIT_TIMEOUTS,
    input?: string,
  ): Promise<string> {
    const run = await runGit(repo.root, args, { timeout: this.timeout(kind), input })
    if (run.code !== 0 || run.timedOut)
      throw new GitError(
        classifyGitError(run.stderr || text(run.stdout), { action, timedOut: run.timedOut, missing: run.missing }),
      )
    return text(run.stdout)
  }

  /** hook 失败时 git 只转发 hook 自己的输出，无法从文字判断：原因不明且仓库有对应 hook 时归为 hook */
  private async hookFailure(repo: Repo, error: unknown, names: string[]): Promise<never> {
    if (!(error instanceof GitError) || error.failure.kind !== 'unknown') throw error
    const configured = text(
      (await runGit(repo.root, ['config', 'core.hooksPath'], { timeout: this.timeout('read') })).stdout,
    ).trim()
    const dir = configured
      ? resolve(repo.root, configured)
      : resolve(
          repo.root,
          text(
            (await runGit(repo.root, ['rev-parse', '--git-path', 'hooks'], { timeout: this.timeout('read') })).stdout,
          ).trim(),
        )
    const found = await Promise.all(
      names.map(name =>
        stat(resolve(dir, name)).then(
          info => info.isFile(),
          () => false,
        ),
      ),
    )
    if (found.some(Boolean)) throw new GitError({ ...error.failure, kind: 'hook', remedies: [] })
    throw error
  }

  private busy(repo: Repo): number {
    return this.host.sessions(repo.workspace).filter(s => s.state !== 'idle').length
  }

  async status(ref: WorkspaceRef): Promise<GitStatus> {
    const empty: GitStatus = {
      repo: false,
      missing: false,
      root: null,
      branch: null,
      detached: false,
      head: null,
      initial: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      remotes: [],
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      truncated: false,
      operation: null,
      fetchedAt: null,
      busySessions: 0,
    }
    const repo = await this.repo(ref)
    if (repo === 'missing') return { ...empty, missing: true }
    if (!repo) return empty
    const [statusRun, remotesRun, pathsRun] = await Promise.all([
      runGit(repo.root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], {
        timeout: this.timeout('read'),
      }),
      runGit(repo.root, ['remote'], { timeout: this.timeout('read') }),
      runGit(
        repo.root,
        [
          'rev-parse',
          '--git-path',
          'MERGE_HEAD',
          '--git-path',
          'rebase-merge',
          '--git-path',
          'rebase-apply',
          '--git-path',
          'CHERRY_PICK_HEAD',
          '--git-path',
          'REVERT_HEAD',
          '--git-path',
          'FETCH_HEAD',
        ],
        { timeout: this.timeout('read') },
      ),
    ])
    if (statusRun.code !== 0)
      throw new Error(
        statusRun.timedOut ? 'Git 状态读取超时' : statusRun.stderr.trim().split('\n').at(-1) || 'Git 状态读取失败',
      )
    const parsed = parseStatusV2(text(statusRun.stdout), repo.prefix)
    const gitPaths = text(pathsRun.stdout)
      .split(/\r?\n/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => resolve(repo.root, p))
    const exists = await Promise.all(
      gitPaths.map(p =>
        stat(p).then(
          info => info,
          () => null,
        ),
      ),
    )
    const [merge, rebaseMerge, rebaseApply, cherry, revert, fetchHead] = exists
    const operation =
      rebaseMerge || rebaseApply ? 'rebase' : merge ? 'merge' : cherry ? 'cherry-pick' : revert ? 'revert' : null
    return {
      ...empty,
      ...parsed,
      repo: true,
      root: repo.root,
      remotes: text(remotesRun.stdout)
        .split(/\r?\n/)
        .map(r => r.trim())
        .filter(Boolean),
      operation,
      fetchedAt: fetchHead ? fetchHead.mtimeMs : null,
      busySessions: this.busy(repo),
    }
  }

  private async blob(repo: Repo, spec: string): Promise<Buffer | null> {
    const run = await runGit(repo.root, ['cat-file', 'blob', spec], {
      timeout: this.timeout('diff'),
      limit: DIFF_LIMIT,
    })
    return run.code === 0 ? run.stdout : null
  }

  private async worktree(repo: Repo, path: string): Promise<Buffer | null> {
    let file: string
    try {
      file = await workspacePath(repo.root, path, 'file')
    } catch {
      return null
    }
    const info = await stat(file)
    if (info.size > DIFF_LIMIT) return Buffer.alloc(DIFF_LIMIT + 1)
    return readFile(file)
  }

  async diff(ref: WorkspaceRef, input: GitDiffInput): Promise<GitDiff> {
    const repo = await this.repo(ref)
    if (!repo || repo === 'missing') throw new Error('当前项目不是可用的 Git 仓库')
    const path = value(input.path, 4096, true).replace(/\\/g, '/')
    const orig = input.origPath ? value(input.origPath, 4096, true).replace(/\\/g, '/') : path
    if (!['staged', 'unstaged', 'untracked', 'conflicted', 'commit'].includes(input.area)) throw new Error('参数不正确')
    let a: Buffer | null, b: Buffer | null
    if (input.area === 'commit') {
      // 历史里的一个文件（docs/ui/git-panel.md §9.5）：from 为 null 是根提交，和空文件比；删除的文件 to 那边没有
      const from = input.from ?? null
      if (!isHash(input.to) || (from !== null && !isHash(from))) throw new Error('参数不正确')
      ;[a, b] = await Promise.all([
        from ? this.blob(repo, `${from}:${orig}`) : Promise.resolve(null),
        this.blob(repo, `${input.to}:${path}`),
      ])
    } else if (input.area === 'staged')
      [a, b] = await Promise.all([this.blob(repo, `HEAD:${orig}`), this.blob(repo, `:${path}`)])
    else if (input.area === 'unstaged')
      [a, b] = await Promise.all([this.blob(repo, `:${path}`), this.worktree(repo, path)])
    else if (input.area === 'untracked') [a, b] = [Buffer.alloc(0), await this.worktree(repo, path)]
    else [a, b] = await Promise.all([this.blob(repo, `:2:${path}`), this.worktree(repo, path)])
    const tooLarge = (a?.length ?? 0) > DIFF_LIMIT || (b?.length ?? 0) > DIFF_LIMIT
    const binary = !tooLarge && ((!!a && isBinary(a)) || (!!b && isBinary(b)))
    if (tooLarge || binary) return { path, original: null, modified: null, binary, tooLarge }
    return { path, original: a ? lf(text(a)) : null, modified: b ? lf(text(b)) : null, binary: false, tooLarge: false }
  }

  async branches(ref: WorkspaceRef): Promise<GitBranch[]> {
    const repo = await this.repo(ref)
    if (!repo || repo === 'missing') return []
    const out = await this.exec(
      repo,
      'switch',
      [
        'for-each-ref',
        '--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(committerdate:unix)%00%(HEAD)%00%(worktreepath)',
        'refs/heads',
        'refs/remotes',
      ],
      'read',
    )
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        const [full, name, upstream, date, head, worktree] = line.split('\0')
        if (!full || full.endsWith('/HEAD')) return []
        const current = head === '*'
        return [
          {
            name,
            remote: full.startsWith('refs/remotes/'),
            upstream: upstream || null,
            current,
            worktree: !current && worktree ? worktree : null,
            committedAt: Number(date) * 1000 || 0,
          },
        ]
      })
      .sort((a, b) => Number(b.current) - Number(a.current) || b.committedAt - a.committedAt)
  }

  // -------------------------------------------------------------------------
  // 提交历史（docs/ui/git-panel.md §9）：只读，不抢 index.lock
  // -------------------------------------------------------------------------

  private versionCache: Promise<number[]> | null = null
  /** git 版本号（[2, 45, 1]）；读不到时当作很旧 */
  private version(): Promise<number[]> {
    this.versionCache ??= runGit('.', ['version'], { timeout: this.timeout('read') }).then(run =>
      (/(\d+)\.(\d+)(?:\.(\d+))?/.exec(text(run.stdout))?.slice(1) ?? ['0', '0']).map(n => Number(n) || 0),
    )
    return this.versionCache
  }

  private async historyRepo(ref: WorkspaceRef): Promise<Repo> {
    const repo = await this.repo(ref)
    if (repo === 'missing') throw new GitError({ kind: 'missing', action: 'history', detail: '', remedies: [] })
    if (!repo) throw new GitError({ kind: 'notRepo', action: 'history', detail: '', remedies: [] })
    return repo
  }

  /** 读一个可能不存在的值（没有上游、还没有提交）：失败时返回空字符串 */
  private async maybe(repo: Repo, args: string[]): Promise<string> {
    const run = await runGit(repo.root, args, { timeout: this.timeout('read') })
    return run.code === 0 ? text(run.stdout).trim() : ''
  }

  async refs(ref: WorkspaceRef): Promise<GitRefs> {
    const repo = await this.historyRepo(ref)
    const [list, head, branch, upstream, remoteHead] = await Promise.all([
      this.exec(
        repo,
        'history',
        ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'],
        'read',
      ),
      this.maybe(repo, ['rev-parse', '--verify', '-q', 'HEAD']),
      this.maybe(repo, ['symbolic-ref', '-q', '--short', 'HEAD']),
      this.maybe(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      this.maybe(repo, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']),
    ])
    const local: string[] = [],
      remote: string[] = [],
      tags: string[] = []
    for (const full of list.split(/\r?\n/).filter(Boolean)) {
      if (full.startsWith('refs/heads/')) local.push(full.slice(11))
      else if (full.startsWith('refs/remotes/')) {
        if (!full.endsWith('/HEAD')) remote.push(full.slice(13))
      } else if (full.startsWith('refs/tags/')) tags.push(full.slice(10))
    }
    // 基础分支：本地 main / master，再看远端默认分支和 origin/main / origin/master；当前就在它上面时不算
    const candidates = ['main', 'master', remoteHead, 'origin/main', 'origin/master'].filter(Boolean)
    const base =
      candidates.find(
        name => (local.includes(name) || remote.includes(name)) && name !== branch && name !== upstream,
      ) ?? null
    const onBase = !!branch && candidates.slice(0, 2).includes(branch)
    return {
      head: head || null,
      branch: branch || null,
      upstream: upstream || null,
      base: onBase ? null : base,
      local,
      remote,
      tags,
    }
  }

  /** 范围 → git log 的起点（完整引用名，避免和文件名、同名标签混淆）；自选的名字必须是已有的引用 */
  private revisions(refs: GitRefs, scope: GitLogScope): { options: string[]; revs: string[] } {
    const full = (name: string): string | null =>
      refs.local.includes(name)
        ? `refs/heads/${name}`
        : refs.remote.includes(name)
          ? `refs/remotes/${name}`
          : refs.tags.includes(name)
            ? `refs/tags/${name}`
            : null
    const head = refs.head ? ['HEAD'] : []
    if (scope === 'all') {
      const any = refs.head || refs.local.length || refs.remote.length || refs.tags.length
      return any ? { options: ['--branches', '--remotes', '--tags'], revs: head } : { options: [], revs: [] }
    }
    if (Array.isArray(scope)) {
      if (scope.length > 200) throw new Error('参数不正确')
      const picked = scope.map(name => (name === 'HEAD' ? (refs.head ? 'HEAD' : null) : full(value(name, 255, true))))
      if (picked.some(p => p === null)) throw new Error('分支不存在，请刷新后重试')
      return { options: [], revs: picked as string[] }
    }
    if (scope !== 'auto') throw new Error('参数不正确')
    const extra = [refs.upstream, refs.base].map(name => (name ? full(name) : null))
    return { options: [], revs: [...head, ...extra.filter((r): r is string => !!r)] }
  }

  /** git 2.31 起 --diff-merges=first-parent 让合并提交也有统计 */
  private async mergeStats(): Promise<boolean> {
    const [major = 0, minor = 0] = await this.version()
    return major > 2 || (major === 2 && minor >= 31)
  }

  async log(ref: WorkspaceRef, input: unknown): Promise<GitLogPage> {
    const q = (input ?? {}) as Partial<GitLogQuery>
    const skip = Number(q.skip) || 0,
      limit = Number(q.limit) || 50
    if (skip < 0 || limit < 1 || limit > 500 || !Number.isInteger(skip) || !Number.isInteger(limit))
      throw new Error('参数不正确')
    const search = q.search === undefined || q.search === null ? '' : value(q.search, 200).trim()
    const repo = await this.historyRepo(ref)
    const filePath = q.path === undefined || q.path === null ? null : this.historyPath(repo, q.path, q.pathBase)
    const refs = await this.refs(ref)
    const { options, revs } = this.revisions(refs, q.scope ?? 'auto')
    const [mergeStats, shallow] = await Promise.all([
      this.mergeStats(),
      this.maybe(repo, ['rev-parse', '--is-shallow-repository']),
    ])
    const base = [
      '-c',
      'log.showSignature=false',
      'log',
      LOG_FORMAT,
      '--decorate=full',
      '--shortstat',
      '--no-ext-diff',
      ...(mergeStats ? ['--diff-merges=first-parent'] : []),
    ]
    const page = (commits: GitCommit[], more: boolean): GitLogPage => ({
      commits,
      more,
      shallow: shallow === 'true',
      ...(filePath ? { path: filePath } : {}),
    })
    if (!revs.length && !options.length) return page([], false)
    const tail = [...options, '--end-of-options', ...revs, ...(filePath ? ['--', filePath] : [])]
    const read = async (args: string[]): Promise<GitCommit[]> => {
      if (!filePath) return parseLog(await this.exec(repo, 'history', [...base, ...args, ...tail], 'read'), mergeStats)
      // 单文件历史（§9.15）：跟着改名往前找；状态和路径、增删行数分两次取（--name-status 会盖过 --numstat）
      const fileBase = base.filter(a => a !== '--shortstat' && !a.startsWith('--diff-merges'))
      const [named, counted] = await Promise.all([
        this.exec(repo, 'history', [...fileBase, '--follow', '-M', '--name-status', ...args, ...tail], 'read'),
        this.exec(repo, 'history', [...fileBase, '--follow', '-M', '--numstat', ...args, ...tail], 'read'),
      ])
      const counts = parseLogNumstat(counted)
      return parseLog(named, mergeStats).map(c => {
        const [insertions, deletions] = counts.get(c.hash) ?? [null, null]
        return c.file ? { ...c, file: { ...c.file, insertions, deletions } } : c
      })
    }
    if (!search) {
      // --follow 配 --skip 时，跳过的范围跨过改名就跟丢了（git 2.55 实测）：单文件历史从头取再切
      if (filePath) {
        const commits = await read([`-n${skip + limit + 1}`])
        return page(commits.slice(skip, skip + limit), commits.length > skip + limit)
      }
      const commits = await read(['--topo-order', `-n${skip + limit + 1}`, `--skip=${skip}`])
      return page(commits.slice(0, limit), commits.length > limit)
    }
    // 单文件历史里搜索：--grep 会把改名那个提交也筛掉，--follow 就跟丢了；取这个文件的全部历史（最多 5000）再筛
    if (filePath) {
      const needle = search.toLowerCase()
      const all = await read(['-n5000'])
      const found = all.filter(
        c =>
          c.subject.toLowerCase().includes(needle) ||
          c.body.toLowerCase().includes(needle) ||
          c.author.toLowerCase().includes(needle) ||
          c.hash.startsWith(needle),
      )
      return page(found.slice(skip, skip + limit), found.length > skip + limit)
    }
    // 搜索：提交信息、作者分开查（git 会把两者按「且」组合），哈希前缀单独解析；合并去重后按提交时间排
    const want = skip + limit + 1
    const [byMessage, byAuthor, byHash] = await Promise.all([
      read(['--regexp-ignore-case', '--fixed-strings', `--grep=${search}`, `-n${want}`]),
      read(['--regexp-ignore-case', '--fixed-strings', `--author=${search}`, `-n${want}`]),
      /^[0-9a-f]{4,64}$/i.test(search)
        ? this.maybe(repo, ['rev-parse', '--verify', '-q', '--end-of-options', `${search.toLowerCase()}^{commit}`])
        : Promise.resolve(''),
    ])
    const exact = isHash(byHash)
      ? parseLog(
          await this.exec(repo, 'history', [...base, '--no-walk', '--end-of-options', byHash], 'read'),
          mergeStats,
        )
      : []
    const seen = new Set<string>()
    const merged = [...exact, ...[...byMessage, ...byAuthor].sort((a, b) => b.committedAt - a.committedAt)].filter(
      c => !seen.has(c.hash) && !!seen.add(c.hash),
    )
    return page(merged.slice(skip, skip + limit), merged.length > skip + limit)
  }

  /** 单文件历史的路径 → 相对仓库根目录；不接受 .. 和 . 段 */
  private historyPath(repo: Repo, path: unknown, base: unknown): string {
    const p = value(path, 4096, true)
      .replace(/\\/g, '/')
      .replace(/^(\.\/)+/, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
    if (!p || p.split('/').some(seg => !seg || seg === '..' || seg === '.')) throw new Error('参数不正确')
    return base === 'repo' ? p : repo.prefix + p
  }

  /** 两个提交之间的改动文件；from 为 null 时是根提交（和空树比） */
  private async changeSet(repo: Repo, from: string | null, to: string): Promise<GitChangeSet> {
    const diff = (format: string) =>
      from
        ? ['diff', '--no-ext-diff', '--no-textconv', '-M', format, '-z', '--end-of-options', from, to]
        : ['diff-tree', '--no-commit-id', '--root', '-r', '-M', format, '-z', '--end-of-options', to]
    const [names, nums] = await Promise.all([
      this.exec(repo, 'history', diff('--name-status'), 'read'),
      this.exec(repo, 'history', diff('--numstat'), 'read'),
    ])
    return { from, to, ...parseCommitFiles(names, nums) }
  }

  async show(ref: WorkspaceRef, hash: unknown): Promise<GitCommitDetail> {
    if (!isHash(hash)) throw new Error('参数不正确')
    const repo = await this.historyRepo(ref)
    const [commit] = parseLog(
      await this.exec(
        repo,
        'history',
        ['-c', 'log.showSignature=false', 'log', LOG_FORMAT, '--decorate=full', '--no-walk', '--end-of-options', hash],
        'read',
      ),
    )
    if (!commit) throw new Error('找不到这个提交')
    // 合并提交和第一父提交比较（docs/ui/git-panel.md §9.5）
    const changes = await this.changeSet(repo, commit.parents[0] ?? null, commit.hash)
    // 上面没带 --shortstat：统计按改动文件算（二进制文件不计行数）
    const stat = changes.files.reduce(
      (s, f) => ({
        files: s.files + 1,
        insertions: s.insertions + (f.insertions ?? 0),
        deletions: s.deletions + (f.deletions ?? 0),
      }),
      { files: 0, insertions: 0, deletions: 0 },
    )
    return { ...changes, commit: { ...commit, stat } }
  }

  /** 哈希或已有引用的短名 → 提交哈希；不认识的名字报错（不把输入当成任意 revision 表达式） */
  private async resolveCommit(repo: Repo, refs: GitRefs, name: unknown): Promise<string> {
    let rev: string
    if (isHash(name)) rev = name
    else {
      const n = value(name, 255, true)
      rev =
        n === 'HEAD' && refs.head
          ? 'HEAD'
          : refs.local.includes(n)
            ? `refs/heads/${n}`
            : refs.remote.includes(n)
              ? `refs/remotes/${n}`
              : refs.tags.includes(n)
                ? `refs/tags/${n}`
                : ''
      if (!rev) throw new Error('分支不存在，请刷新后重试')
    }
    const out = await this.exec(
      repo,
      'history',
      ['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`],
      'read',
    )
    return out.trim()
  }

  async compare(ref: WorkspaceRef, target: unknown): Promise<GitCompareResult> {
    const repo = await this.historyRepo(ref)
    const refs = await this.refs(ref)
    let from: string, to: string
    if (target && typeof target === 'object') {
      // 任意两点（§9.6 第二期「和…比较」）：直接比较两端，提交数是 from..to
      const t = target as { from?: unknown; to?: unknown }
      ;[from, to] = await Promise.all([this.resolveCommit(repo, refs, t.from), this.resolveCommit(repo, refs, t.to)])
    } else {
      const kind = target
      if (kind !== 'outgoing' && kind !== 'incoming' && kind !== 'base') throw new Error('参数不正确')
      const other = kind === 'base' ? refs.base : refs.upstream
      if (!refs.head || !other) throw new Error(kind === 'base' ? '没有找到基础分支' : '当前分支没有上游')
      const otherRef = refs.local.includes(other) ? `refs/heads/${other}` : `refs/remotes/${other}`
      const [tip, mergeBase] = await Promise.all([
        this.exec(repo, 'history', ['rev-parse', '--verify', '--end-of-options', `${otherRef}^{commit}`], 'read'),
        this.exec(repo, 'history', ['merge-base', '--end-of-options', 'HEAD', otherRef], 'read'),
      ])
      from = mergeBase.trim()
      to = kind === 'incoming' ? tip.trim() : refs.head
    }
    const [changes, count] = await Promise.all([
      this.changeSet(repo, from, to),
      this.exec(repo, 'history', ['rev-list', '--count', '--end-of-options', `${from}..${to}`], 'read'),
    ])
    return { ...changes, commits: Number(count.trim()) || 0 }
  }

  /**
   * 历史里会改动仓库的操作（docs/ui/git-panel.md §9.6 第二期）。动工作区的（检出、cherry-pick、revert、reset）
   * 有会话在运行时拒绝；只动引用的（新建 / 删除标签、删除分支）不拦。合并提交的 cherry-pick / revert 按第一父提交。
   */
  historyAction(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const v = (input ?? {}) as Record<string, unknown>
    const kind = v.kind
    if (['checkout', 'cherryPick', 'revert', 'reset', 'tag'].includes(kind as string) && !isHash(v.hash))
      throw new Error('参数不正确')
    const hash = v.hash as string
    const invalid = (detail: string) => new GitError({ kind: 'invalid', action: 'history', detail, remedies: [] })
    switch (kind) {
      case 'checkout':
        return this.mutate(
          ref,
          'history',
          async repo => {
            await this.exec(repo, 'history', ['switch', '--detach', hash], 'stage')
          },
          true,
        )
      case 'cherryPick':
      case 'revert':
        return this.mutate(
          ref,
          'history',
          async repo => {
            const line = await this.exec(
              repo,
              'history',
              ['rev-list', '--parents', '-n1', '--end-of-options', hash],
              'read',
            )
            const merge = line.trim().split(' ').length > 2 ? ['-m', '1'] : []
            const args = kind === 'revert' ? ['revert', '--no-edit', ...merge, hash] : ['cherry-pick', ...merge, hash]
            await this.exec(repo, 'history', args, 'commit').catch(error =>
              this.hookFailure(repo, error, ['pre-commit', 'prepare-commit-msg', 'commit-msg']),
            )
          },
          true,
        )
      case 'reset': {
        const mode = v.mode
        if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') throw new Error('参数不正确')
        return this.mutate(
          ref,
          'history',
          async (repo, status) => {
            if (status.operation) throw invalid('有进行中的合并、变基或 cherry-pick，请先中止或完成')
            await this.exec(repo, 'history', ['reset', '-q', `--${mode}`, hash], 'stage')
          },
          true,
        )
      }
      case 'tag': {
        const name = value(v.name, 255, true)
        const message = typeof v.message === 'string' ? v.message.trim().slice(0, 20_000) : ''
        return this.mutate(ref, 'history', async repo => {
          if (name.startsWith('-')) throw invalid('标签名不能以 - 开头')
          await this.exec(repo, 'history', ['check-ref-format', `refs/tags/${name}`], 'read').catch(() => {
            throw invalid('标签名不符合 Git 规则')
          })
          // 有说明时建附注标签（说明从标准输入传入）
          await this.exec(
            repo,
            'history',
            message
              ? ['tag', '-a', '-F', '-', '--end-of-options', name, hash]
              : ['tag', '--end-of-options', name, hash],
            'stage',
            message || undefined,
          )
        })
      }
      case 'deleteBranch':
      case 'deleteTag': {
        const name = value(v.name, 255, true)
        return this.mutate(ref, 'history', async repo => {
          const refs = await this.refs(ref)
          if (!(kind === 'deleteBranch' ? refs.local : refs.tags).includes(name))
            throw new Error(kind === 'deleteBranch' ? '分支不存在，请刷新后重试' : '标签不存在，请刷新后重试')
          if (kind === 'deleteBranch' && name === refs.branch) throw invalid('不能删除当前分支')
          await this.exec(
            repo,
            'history',
            kind === 'deleteTag'
              ? ['tag', '-d', '--end-of-options', name]
              : ['branch', v.force === true ? '-D' : '-d', '--end-of-options', name],
            'stage',
          )
        })
      }
      default:
        throw new Error('参数不正确')
    }
  }

  /** 写操作：按仓库串行；成功后通知界面并返回最新状态，失败返回分类后的原因（不抛错，方便跨 IPC / SSH） */
  private async mutate(
    ref: WorkspaceRef,
    action: GitAction,
    fn: (repo: Repo, status: GitStatus) => Promise<void>,
    guard = false,
  ): Promise<GitResult> {
    const repo = await this.repo(ref)
    if (repo === 'missing')
      return { ok: false, failure: { kind: 'missing', action, detail: '', remedies: [] }, status: null }
    if (!repo) return { ok: false, failure: { kind: 'notRepo', action, detail: '', remedies: [] }, status: null }
    const key = process.platform === 'win32' ? repo.root.toLowerCase() : repo.root
    const prior = this.locks.get(key) ?? Promise.resolve()
    const task = prior
      .catch(() => {})
      .then(async (): Promise<GitResult> => {
        const before = await this.status(ref)
        if (guard && before.busySessions > 0)
          return { ok: false, failure: { kind: 'busy', action, detail: '', remedies: [] }, status: before }
        try {
          await fn(repo, before)
        } catch (error) {
          const failure =
            error instanceof GitError
              ? error.failure
              : { kind: 'invalid' as const, action, detail: (error as Error).message, remedies: [] }
          this.changed()
          return { ok: false, failure, status: await this.status(ref).catch(() => null) }
        }
        this.changed()
        return { ok: true, status: await this.status(ref) }
      })
    this.locks.set(key, task)
    try {
      return await task
    } finally {
      if (this.locks.get(key) === task) this.locks.delete(key)
    }
  }

  stage(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const list = paths(input)
    return this.mutate(ref, 'stage', async repo => {
      await this.exec(repo, 'stage', list === 'all' ? ['add', '-A'] : ['add', '-A', '--', ...list], 'stage')
    })
  }

  unstage(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const list = paths(input)
    return this.mutate(ref, 'unstage', async (repo, status) => {
      const target = list === 'all' ? ['.'] : list
      // 还没有任何提交时没有 HEAD 可以 reset，改为从暂存区移除
      if (status.initial) await this.exec(repo, 'unstage', ['rm', '--cached', '-r', '-q', '--', ...target], 'stage')
      else
        await this.exec(
          repo,
          'unstage',
          list === 'all' ? ['reset', '-q'] : ['reset', '-q', 'HEAD', '--', ...list],
          'stage',
        )
    })
  }

  discard(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const all = input === 'all'
    const v = all ? null : (input as { paths?: unknown; untracked?: unknown } | null)
    const tracked = all ? [] : pathList(v?.paths ?? []),
      untracked = all ? [] : pathList(v?.untracked ?? [])
    return this.mutate(ref, 'discard', async (repo, status) => {
      const restore = all ? status.unstaged.filter(f => !f.submodule).map(f => f.path) : tracked
      // 只删除刚读到的未跟踪列表里的文件
      const listed = new Set(status.untracked.map(f => f.path))
      const remove = all ? [...listed] : untracked.filter(p => listed.has(p))
      if (!all && remove.length !== untracked.length) throw new Error('文件状态已变化，请刷新后重试')
      if (restore.length) await this.exec(repo, 'discard', ['checkout', '--', ...restore], 'stage')
      if (!remove.length) return
      if (this.opts.trash) {
        const files: TrashFile[] = []
        for (const path of remove)
          files.push({ absolute: await workspacePath(repo.root, path, 'file'), relative: path })
        await this.opts.trash(files)
      } else await this.exec(repo, 'discard', ['clean', '-f', '-q', '--', ...remove], 'stage')
    })
  }

  commit(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const v = (input ?? {}) as { message?: unknown; all?: unknown; push?: unknown }
    const message = value(v.message, 20_000, true)
    return this.mutate(ref, 'commit', async (repo, status) => {
      if (v.all === true) await this.exec(repo, 'commit', ['add', '-A'], 'stage')
      else if (!status.staged.length)
        throw new GitError({ kind: 'nothing', action: 'commit', detail: '', remedies: [] })
      await this.exec(repo, 'commit', ['commit', '-q', '-F', '-'], 'commit', message).catch(error =>
        this.hookFailure(repo, error, ['pre-commit', 'prepare-commit-msg', 'commit-msg']),
      )
      if (v.push === true) await this.pushIn(repo, await this.status(ref), false)
    })
  }

  private async pushIn(repo: Repo, status: GitStatus, publish: boolean): Promise<void> {
    if (status.detached)
      throw new GitError({
        kind: 'invalid',
        action: 'push',
        detail: '分离 HEAD 不能推送，请先切换到分支',
        remedies: [],
      })
    const hook = (error: unknown) => this.hookFailure(repo, error, ['pre-push'])
    if (status.upstream && !publish) {
      await this.exec(repo, 'push', ['push'], 'remote').catch(hook)
      return
    }
    if (!status.remotes.length) throw new GitError({ kind: 'noRemote', action: 'push', detail: '', remedies: [] })
    const remote = status.remotes.length === 1 ? status.remotes[0] : status.remotes.includes('origin') ? 'origin' : null
    if (!remote) throw new GitError({ kind: 'noUpstream', action: 'push', detail: '', remedies: [] })
    await this.exec(repo, 'push', ['push', '-u', remote, 'HEAD'], 'remote').catch(hook)
  }

  push(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const publish = (input as { publish?: unknown } | null)?.publish === true
    return this.mutate(ref, 'push', (repo, status) => this.pushIn(repo, status, publish))
  }

  pull(ref: WorkspaceRef, mode: unknown): Promise<GitResult> {
    const args: Record<GitPullMode, string[]> = {
      'ff-only': ['pull', '--ff-only'],
      rebase: ['pull', '--rebase'],
      stash: ['pull', '--rebase', '--autostash'],
    }
    if (typeof mode !== 'string' || !(mode in args)) throw new Error('参数不正确')
    return this.mutate(
      ref,
      'pull',
      async repo => {
        await this.exec(repo, 'pull', args[mode as GitPullMode], 'remote')
      },
      true,
    )
  }

  fetch(ref: WorkspaceRef): Promise<GitResult> {
    return this.mutate(ref, 'fetch', async (repo, status) => {
      if (!status.remotes.length) throw new GitError({ kind: 'noRemote', action: 'fetch', detail: '', remedies: [] })
      await this.exec(repo, 'fetch', ['fetch', '--prune'], 'remote')
    })
  }

  switchBranch(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const v = (input ?? {}) as { branch?: unknown; remote?: unknown }
    const branch = value(v.branch, 255, true),
      remote = v.remote === true
    return this.mutate(
      ref,
      'switch',
      async repo => {
        const list = await this.branches(ref)
        const found = list.find(b => b.name === branch && b.remote === remote)
        if (!found) throw new Error('分支不存在，请刷新后重试')
        if (!remote) {
          await this.exec(repo, 'switch', ['switch', branch], 'stage')
          return
        }
        const local = branch.slice(branch.indexOf('/') + 1)
        if (list.some(b => !b.remote && b.name === local)) await this.exec(repo, 'switch', ['switch', local], 'stage')
        else await this.exec(repo, 'switch', ['switch', '--track', branch], 'stage')
      },
      true,
    )
  }

  createBranch(ref: WorkspaceRef, input: unknown): Promise<GitResult> {
    const v = (input ?? {}) as { name?: unknown; start?: unknown; switch?: unknown }
    const name = value(v.name, 255, true)
    // 在历史里的某个提交上新建（docs/ui/git-panel.md §9.6）：不切过去时只新建引用，不动工作区，会话运行中也可以
    if (v.start !== undefined && v.start !== null) {
      if (!isHash(v.start)) throw new Error('参数不正确')
      const start = v.start,
        switchTo = v.switch === true
      return this.mutate(
        ref,
        'create',
        async repo => {
          await this.checkBranchName(repo, name)
          await this.exec(
            repo,
            'create',
            switchTo ? ['switch', '-c', name, start] : ['branch', '--end-of-options', name, start],
            'stage',
          )
        },
        switchTo,
      )
    }
    return this.mutate(
      ref,
      'create',
      async repo => {
        await this.checkBranchName(repo, name)
        await this.exec(repo, 'create', ['switch', '-c', name], 'stage')
      },
      true,
    )
  }

  private async checkBranchName(repo: Repo, name: string): Promise<void> {
    if (name.startsWith('-'))
      throw new GitError({ kind: 'invalid', action: 'create', detail: '分支名不能以 - 开头', remedies: [] })
    await this.exec(repo, 'create', ['check-ref-format', '--branch', name], 'read').catch(() => {
      throw new GitError({ kind: 'invalid', action: 'create', detail: '分支名不符合 Git 规则', remedies: [] })
    })
  }

  operation(ref: WorkspaceRef, action: unknown): Promise<GitResult> {
    if (action !== 'abort' && action !== 'continue') throw new Error('参数不正确')
    return this.mutate(
      ref,
      'operation',
      async (repo, status) => {
        if (!status.operation) throw new Error('没有进行中的合并或变基')
        if (action === 'continue' && status.conflicted.length)
          throw new GitError({ kind: 'conflict', action: 'operation', detail: '', remedies: ['abort'] })
        await this.exec(repo, 'operation', [status.operation, `--${action}`], 'commit')
      },
      true,
    )
  }
}
