// Git 面板的解析与错误分类（docs/ui/git-panel.md）。纯函数，不依赖 Electron，SSH 辅助进程也会打包。
import type {
  GitAction,
  GitCode,
  GitFailure,
  GitFailureKind,
  GitFileChange,
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
  ['worktree', /already checked out|is already used by worktree|already used by worktree/i],
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
  let kind: GitFailureKind = 'unknown'
  if (info.missing) kind = 'missing'
  else if (info.timedOut) kind = 'timeout'
  else kind = RULES.find(([, re]) => re.test(stderr))?.[0] ?? 'unknown'
  let remedies = REMEDIES[kind] ?? []
  if (kind === 'dirty' && info.action === 'pull') remedies = ['pullStash']
  if (kind === 'conflict' && info.action !== 'pull' && info.action !== 'operation') remedies = []
  return { kind, action: info.action, detail, remedies }
}
