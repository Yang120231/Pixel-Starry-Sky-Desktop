// Git 面板的解析与错误分类（docs/ui/git-panel.md）。纯函数，不依赖 Electron，SSH 辅助进程也会打包。
import type {
  GitAction,
  GitCode,
  GitCommit,
  GitCommitCode,
  GitCommitFile,
  GitFailure,
  GitFailureKind,
  GitFileChange,
  GitRefLabel,
  GitRemedy,
} from '../../../shared/types/project-tools'

export const MAX_ENTRIES = 5000

export interface ParsedStatus {
  head: string | null
  initial: boolean
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
  truncated: boolean
}

const CODES = new Set(['M', 'A', 'D', 'R', 'C', 'T', 'U'])
const code = (c: string): GitCode => (CODES.has(c) ? (c as GitCode) : 'M')

/** prefix 是工作区相对仓库根目录的前缀（`rev-parse --show-prefix`，如 "web/" 或 ""） */
export function localPath(path: string, prefix: string): string | null {
  if (!prefix) return path
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : null
}

/**
 * 解析 `git status --porcelain=v2 -z --branch`：分支头、普通改动（1）、改名 / 复制（2，-z 时原路径是下一个 NUL 段）、
 * 冲突（u）、未跟踪（?）。X ≠ . 进「暂存的更改」，Y ≠ . 进「更改」，同一文件可以两边都有。
 */
export function parseStatusV2(stdout: string, prefix: string, max = MAX_ENTRIES): ParsedStatus {
  const result: ParsedStatus = {
    head: null,
    initial: false,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    truncated: false,
  }
  const tokens = stdout.split('\0')
  let count = 0
  const push = (list: GitFileChange[], entry: Omit<GitFileChange, 'local'>): void => {
    if (count >= max) {
      result.truncated = true
      return
    }
    count++
    list.push({ ...entry, local: localPath(entry.path, prefix) })
  }
  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i]
    if (!line) continue
    if (line.startsWith('# ')) {
      const [key, ...rest] = line.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') {
        result.initial = value === '(initial)'
        result.head = result.initial ? null : value
      } else if (key === 'branch.head') {
        result.detached = value === '(detached)'
        result.branch = result.detached ? null : value
      } else if (key === 'branch.upstream') result.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          result.ahead = Number(m[1])
          result.behind = Number(m[2])
        }
      }
      continue
    }
    const type = line[0]
    if (type === '?') {
      push(result.untracked, { path: line.slice(2), origPath: null, code: '?', submodule: false })
      continue
    }
    if (type !== '1' && type !== '2' && type !== 'u') continue
    const parts = line.split(' ')
    const xy = parts[1] ?? '..',
      submodule = (parts[2] ?? 'N').startsWith('S')
    if (type === 'u') {
      push(result.conflicted, { path: parts.slice(10).join(' '), origPath: null, code: 'U', submodule })
      continue
    }
    const path = parts.slice(type === '1' ? 8 : 9).join(' ')
    const origPath = type === '2' ? (tokens[++i] ?? null) : null
    const [x, y] = [xy[0], xy[1]]
    if (x && x !== '.') push(result.staged, { path, origPath, code: code(x), submodule })
    if (y && y !== '.') push(result.unstaged, { path, origPath: null, code: code(y), submodule })
  }
  return result
}

// ---------------------------------------------------------------------------
// 提交历史（docs/ui/git-panel.md §9）
// ---------------------------------------------------------------------------

/** git log 的格式：每条以 \x1e 开头，字段用 \x1f 分隔，提交信息后面是 \x1d，再后面是 --shortstat 的统计行 */
export const LOG_FORMAT = '--format=%x1e%H%x1f%P%x1f%aN%x1f%aE%x1f%at%x1f%ct%x1f%D%x1f%B%x1d'

/** `%D`（--decorate=full）→ 引用标记；跳过 refs/remotes/x/HEAD、refs/stash 之类 */
export function parseDecorations(text: string): GitRefLabel[] {
  const refs: GitRefLabel[] = []
  for (const part of text.split(', ')) {
    const item = part.trim()
    if (!item) continue
    if (item === 'HEAD') refs.push({ kind: 'head', name: 'HEAD' })
    else if (item.startsWith('HEAD -> ')) {
      const name = item.slice(8).replace(/^refs\/heads\//, '')
      refs.push({ kind: 'branch', name, current: true })
    } else if (item.startsWith('tag: ')) refs.push({ kind: 'tag', name: item.slice(5).replace(/^refs\/tags\//, '') })
    else if (item.startsWith('refs/heads/')) refs.push({ kind: 'branch', name: item.slice(11) })
    else if (item.startsWith('refs/remotes/')) {
      if (!item.endsWith('/HEAD')) refs.push({ kind: 'remote', name: item.slice(13) })
    } else if (item.startsWith('refs/tags/')) refs.push({ kind: 'tag', name: item.slice(10) })
  }
  return refs
}

function parseShortStat(text: string): GitCommit['stat'] {
  const files = /(\d+) files? changed/.exec(text)
  if (!files) return null
  return {
    files: Number(files[1]),
    insertions: Number(/(\d+) insertions?\(\+\)/.exec(text)?.[1] ?? 0),
    deletions: Number(/(\d+) deletions?\(-\)/.exec(text)?.[1] ?? 0),
  }
}

/**
 * 解析 LOG_FORMAT + --shortstat 的输出。没有统计行的提交（空提交、合并提交）记作 0；
 * mergeStats 为假（旧版 git 不支持 --diff-merges）时合并提交记作 null。
 */
export function parseLog(stdout: string, mergeStats = true): GitCommit[] {
  const commits: GitCommit[] = []
  for (const record of stdout.split('\x1e')) {
    const end = record.lastIndexOf('\x1d')
    if (end < 0) continue
    const fields = record.slice(0, end).split('\x1f')
    if (fields.length < 8) continue
    const [hash, parents, author, email, authored, committed, refs] = fields
    if (!/^[0-9a-f]{7,64}$/.test(hash)) continue
    const message = fields.slice(7).join('\x1f').replace(/\r\n/g, '\n').replace(/\s+$/, '')
    const newline = message.indexOf('\n')
    const parentList = parents.split(' ').filter(Boolean)
    const stat = parseShortStat(record.slice(end + 1))
    commits.push({
      hash,
      parents: parentList,
      author,
      email,
      authoredAt: Number(authored) * 1000 || 0,
      committedAt: Number(committed) * 1000 || 0,
      subject: (newline < 0 ? message : message.slice(0, newline)).trim(),
      body: newline < 0 ? '' : message.slice(newline + 1).replace(/^\n+/, ''),
      refs: parseDecorations(refs),
      stat: stat ?? (parentList.length > 1 && !mergeStats ? null : { files: 0, insertions: 0, deletions: 0 }),
    })
  }
  return commits
}

const COMMIT_CODES = new Set(['A', 'M', 'D', 'R', 'C', 'T'])

/**
 * `git diff --name-status -z -M` + `--numstat -z -M` → 改动文件。
 * name-status：`R100\0旧\0新\0`；numstat：`增\t删\t路径\0`，改名时路径为空、后面跟 `旧\0新\0`，二进制是 `-\t-`。
 */
export function parseCommitFiles(
  nameStatus: string,
  numstat: string,
  max = MAX_ENTRIES,
): { files: GitCommitFile[]; truncated: boolean } {
  const stats = new Map<string, [number | null, number | null]>()
  const nums = numstat.split('\0')
  for (let i = 0; i < nums.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(nums[i].replace(/^\n/, ''))
    if (!m) continue
    let path = m[3]
    if (!path) {
      i += 2
      path = nums[i] ?? ''
    }
    stats.set(path, [m[1] === '-' ? null : Number(m[1]), m[2] === '-' ? null : Number(m[2])])
  }
  const files: GitCommitFile[] = []
  let truncated = false
  const tokens = nameStatus.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i].replace(/^\n/, '')
    if (!status) continue
    const letter = status[0]
    const renamed = letter === 'R' || letter === 'C'
    const origPath = renamed ? (tokens[++i] ?? null) : null
    const path = tokens[++i]
    if (path === undefined) break
    if (files.length >= max) {
      truncated = true
      break
    }
    const [insertions, deletions] = stats.get(path) ?? [null, null]
    files.push({
      path,
      origPath,
      code: (COMMIT_CODES.has(letter) ? letter : 'M') as GitCommitCode,
      insertions,
      deletions,
    })
  }
  return { files, truncated }
}

/** 提交哈希：7–64 位十六进制（SHA-1 / SHA-256） */
export const isHash = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{7,64}$/.test(s)

const RULES: Array<[GitFailureKind, RegExp]> = [
  ['locked', /index\.lock|Unable to create .*\.lock|another git process/i],
  ['rejected', /! \[rejected\]|\(fetch first\)|non-fast-forward|Updates were rejected/i],
  ['diverged', /Not possible to fast-forward|divergent branches|have diverged/i],
  ['conflict', /CONFLICT \(|could not apply|Merge conflict|fix conflicts|unmerged files|You have unmerged paths/i],
  [
    'dirty',
    /would be overwritten|Please commit your changes or stash them|cannot pull with rebase: You have unstaged changes|Your local changes/i,
  ],
  [
    'auth',
    /Authentication failed|could not read Username|could not read Password|terminal prompts disabled|Permission denied \(publickey|HTTP Basic: Access denied|The requested URL returned error: 40[13]|Invalid username or password|access denied|Repository not found/i,
  ],
  [
    'network',
    /Could not resolve host|Failed to connect|Connection refused|Connection timed out|Connection reset|unable to access|early EOF|Network is unreachable|Could not read from remote repository|SSL|TLS/i,
  ],
  ['hook', /hook.*(declined|failed|exited)|pre-commit|pre-push|pre-receive hook|commit-msg/i],
  ['identity', /Please tell me who you are|Author identity unknown|empty ident name/i],
  ['noUpstream', /no upstream|has no upstream branch|no tracking information|There is no tracking information/i],
  ['noRemote', /No configured push destination|does not appear to be a git repository|No remote repository specified/i],
  ['worktree', /already checked out|used by worktree|checked out at/i],
  ['unmerged', /is not fully merged/i],
  ['nothing', /nothing to commit|no changes added to commit|nothing added to commit/i],
  ['notRepo', /not a git repository/i],
]

const REMEDIES: Partial<Record<GitFailureKind, GitRemedy[]>> = {
  rejected: ['pullRebase', 'retry'],
  diverged: ['pullRebase'],
  noUpstream: ['publish'],
  noRemote: [],
  network: ['retry', 'terminal'],
  timeout: ['retry', 'terminal'],
  locked: ['retry'],
  auth: ['terminal'],
  identity: ['terminal'],
  conflict: ['abort'],
}

/** git 的英文输出（运行时设置 LC_ALL=C）→ 失败类型和处理办法 */
export function classifyGitError(
  stderr: string,
  info: { action: GitAction; timedOut?: boolean; missing?: boolean },
): GitFailure {
  const detail = stderr.trim().slice(-4000)
  let kind: GitFailureKind
  if (info.missing) kind = 'missing'
  else if (info.timedOut) kind = 'timeout'
  else kind = RULES.find(([, re]) => re.test(stderr))?.[0] ?? 'unknown'
  let remedies = REMEDIES[kind] ?? []
  if (kind === 'dirty' && info.action === 'pull') remedies = ['pullStash']
  // 拉取、继续、历史里的 cherry-pick / revert 冲突时可以中止
  if (kind === 'conflict' && !['pull', 'operation', 'history'].includes(info.action)) remedies = []
  return { kind, action: info.action, detail, remedies }
}
