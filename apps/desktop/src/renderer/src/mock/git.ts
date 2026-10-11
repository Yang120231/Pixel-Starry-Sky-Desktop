// Git 面板的演示数据（docs/ui/git-panel.md），只在 `pnpm dev:demo` 显示
import type {
  GitBranch,
  GitCommit,
  GitCommitDetail,
  GitCommitFile,
  GitCompareTarget,
  GitCompareResult,
  GitDiff,
  GitFileChange,
  GitLogPage,
  GitLogQuery,
  GitRefLabel,
  GitRefs,
  GitStatus,
} from '../../../shared/types/project-tools'

const file = (path: string, code: GitFileChange['code'], origPath: string | null = null): GitFileChange => ({
  path,
  origPath,
  code,
  local: path,
  submodule: false,
})

export const demoGitStatus: GitStatus = {
  repo: true,
  missing: false,
  root: 'D:/pixel-web',
  branch: 'feat/settings-form',
  detached: false,
  head: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  initial: false,
  upstream: 'origin/feat/settings-form',
  ahead: 2,
  behind: 1,
  remotes: ['origin'],
  conflicted: [],
  staged: [file('src/settings/AccountForm.tsx', 'M'), file('src/settings/fields/useField.ts', 'A')],
  unstaged: [
    file('src/settings/AccountForm.tsx', 'M'),
    file('src/settings/AppearanceForm.tsx', 'M'),
    file('src/legacy/OldForm.tsx', 'D'),
  ],
  untracked: [file('docs/表单迁移.md', '?')],
  truncated: false,
  operation: null,
  fetchedAt: Date.now() - 6 * 60_000,
  busySessions: 0,
}

export const demoGitBranches: GitBranch[] = [
  {
    name: 'feat/settings-form',
    remote: false,
    upstream: 'origin/feat/settings-form',
    current: true,
    worktree: null,
    committedAt: Date.now() - 3600_000,
  },
  {
    name: 'main',
    remote: false,
    upstream: 'origin/main',
    current: false,
    worktree: null,
    committedAt: Date.now() - 86400_000,
  },
  {
    name: 'pixelsky/review-ui',
    remote: false,
    upstream: null,
    current: false,
    worktree: 'D:/pixel-web-copies/review-ui',
    committedAt: Date.now() - 2 * 86400_000,
  },
  {
    name: 'origin/main',
    remote: true,
    upstream: null,
    current: false,
    worktree: null,
    committedAt: Date.now() - 86400_000,
  },
  {
    name: 'origin/release/0.1',
    remote: true,
    upstream: null,
    current: false,
    worktree: null,
    committedAt: Date.now() - 5 * 86400_000,
  },
]

const before = `import { useState } from 'react'

export function AccountForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const valid = email.includes('@')
  return (
    <form>
      <input value={name} onChange={e => setName(e.target.value)} />
      <input value={email} onChange={e => setEmail(e.target.value)} />
      {!valid && <p className="error">邮箱格式不对</p>}
      <button disabled={!valid}>保存</button>
    </form>
  )
}
`
const after = `import { useField } from './fields/useField'

export function AccountForm() {
  const name = useField('')
  const email = useField('', value => value.includes('@') ? null : '请输入有效的邮箱')
  return (
    <form>
      <input {...name.props} />
      <input {...email.props} />
      {email.error && <p className="error">{email.error}</p>}
      <button disabled={!!email.error}>保存</button>
    </form>
  )
}
`
export function demoGitDiff(path: string): GitDiff {
  if (path.endsWith('AccountForm.tsx'))
    return { path, original: before, modified: after, binary: false, tooLarge: false }
  if (path.endsWith('useField.ts'))
    return {
      path,
      original: '',
      modified:
        "import { useState } from 'react'\n\nexport function useField(initial: string, validate?: (value: string) => string | null) {\n  const [value, setValue] = useState(initial)\n  const error = validate?.(value) ?? null\n  return { value, error, props: { value, onChange: (e: { target: { value: string } }) => setValue(e.target.value) } }\n}\n",
      binary: false,
      tooLarge: false,
    }
  if (path.endsWith('OldForm.tsx'))
    return {
      path,
      original: 'export function OldForm() {\n  return null\n}\n',
      modified: null,
      binary: false,
      tooLarge: false,
    }
  return { path, original: '', modified: '# 表单迁移\n\n- [x] 账号\n- [ ] 外观\n', binary: false, tooLarge: false }
}

// ---------------------------------------------------------------------------
// 提交历史（docs/ui/git-panel.md §9）：功能分支领先 2 个、落后 1 个（和上面的状态一致），
// 基础分支 main 上有一次合并和两个标签，另有一个远端发布分支
// ---------------------------------------------------------------------------
const hash = (seed: string): string => (seed.repeat(40) + '0'.repeat(40)).slice(0, 40)
const HOUR = 3600_000,
  DAY = 24 * HOUR
type DemoCommit = GitCommit & { files: GitCommitFile[] }
const changed = (path: string, code: GitCommitFile['code'], ins: number | null, del: number | null, orig?: string) => ({
  path,
  origPath: orig ?? null,
  code,
  insertions: ins,
  deletions: del,
})
function demoCommit(
  id: string,
  parents: string[],
  ago: number,
  author: [string, string],
  message: string,
  refs: GitRefLabel[],
  files: GitCommitFile[],
): DemoCommit {
  const [subject, ...rest] = message.split('\n')
  const at = Date.now() - ago
  return {
    hash: hash(id),
    parents: parents.map(hash),
    author: author[0],
    email: author[1],
    authoredAt: at,
    committedAt: at,
    subject,
    body: rest.join('\n').replace(/^\n+/, ''),
    refs,
    stat: {
      files: files.length,
      insertions: files.reduce((n, f) => n + (f.insertions ?? 0), 0),
      deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
    },
    files,
  }
}
const ME: [string, string] = ['陈默', 'chenmo@pixel.dev'],
  LIN: [string, string] = ['林夏', 'linxia@pixel.dev'],
  BOT: [string, string] = ['Claude', 'noreply@anthropic.com']
const HISTORY: DemoCommit[] = [
  demoCommit(
    'e1',
    ['c8'],
    40 * 60_000,
    LIN,
    '修正表单之间的间距',
    [{ kind: 'remote', name: 'origin/feat/settings-form' }],
    [changed('src/settings/settings.css', 'M', 6, 4)],
  ),
  demoCommit(
    'a1b2c3d4e5f6',
    ['c9'],
    HOUR,
    ME,
    '表单字段改用 useField\n\n账号表单和外观表单共用一套字段状态和校验，去掉重复的 useState。',
    [{ kind: 'branch', name: 'feat/settings-form', current: true }],
    [
      changed('src/settings/AccountForm.tsx', 'M', 8, 9),
      changed('src/settings/fields/useField.ts', 'A', 6, 0),
      changed('src/legacy/OldForm.tsx', 'D', 0, 3),
    ],
  ),
  demoCommit(
    'c9',
    ['c8'],
    3 * HOUR,
    BOT,
    '账号表单加邮箱校验提示',
    [],
    [changed('src/settings/AccountForm.tsx', 'M', 4, 1)],
  ),
  demoCommit(
    'c8',
    ['c7'],
    DAY + 2 * HOUR,
    ME,
    '设置页拆成独立表单',
    [],
    [
      changed('src/settings/AccountForm.tsx', 'A', 15, 0),
      changed('src/settings/AppearanceForm.tsx', 'A', 22, 0),
      changed('src/settings/SettingsPage.tsx', 'M', 5, 41),
    ],
  ),
  demoCommit(
    'c7',
    ['b3'],
    2 * DAY,
    ME,
    '新增设置页路由\n\n- /settings/account\n- /settings/appearance\n\n旧的 /preferences 跳转到 /settings/account。',
    [],
    [changed('src/routes.tsx', 'M', 12, 2), changed('src/settings/SettingsPage.tsx', 'A', 48, 0)],
  ),
  demoCommit(
    'b4',
    ['b3', 'f1'],
    2 * DAY + 5 * HOUR,
    LIN,
    "Merge branch 'fix/login-redirect'",
    [
      { kind: 'branch', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
    ],
    [changed('src/auth/redirect.ts', 'A', 18, 0), changed('src/auth/LoginPage.tsx', 'M', 3, 1)],
  ),
  demoCommit(
    'f1',
    ['b3'],
    3 * DAY,
    LIN,
    '登录后跳回原来的页面',
    [],
    [changed('src/auth/redirect.ts', 'A', 18, 0), changed('src/auth/LoginPage.tsx', 'M', 3, 1)],
  ),
  demoCommit(
    'b3',
    ['b2'],
    5 * DAY,
    ME,
    '升级到 React 19',
    [{ kind: 'tag', name: 'v0.2.0' }],
    [
      changed('package.json', 'M', 2, 2),
      changed('pnpm-lock.yaml', 'M', 310, 287),
      changed('public/logo.png', 'M', null, null),
    ],
  ),
  demoCommit(
    'b2',
    ['b1'],
    9 * DAY,
    ME,
    '首页改成按需加载',
    [{ kind: 'remote', name: 'origin/release/0.1' }],
    [changed('src/Home.tsx', 'M', 9, 3), changed('src/lazy.ts', 'R', 1, 1, 'src/loadable.ts')],
  ),
  demoCommit(
    'b1',
    [],
    20 * DAY,
    ME,
    '初始化项目',
    [{ kind: 'tag', name: 'v0.1.0' }],
    [changed('package.json', 'A', 24, 0), changed('src/Home.tsx', 'A', 30, 0), changed('src/loadable.ts', 'A', 8, 0)],
  ),
]
const strip = ({ files: _files, ...commit }: DemoCommit): GitCommit => commit
const byHash = (h: string) => HISTORY.find(c => c.hash === h)

function demoLog(query: GitLogQuery): GitLogPage {
  // 自动范围不含远端发布分支独有的提交（这里没有），全部 / 自选都用整份
  const q = query.search?.trim().toLowerCase() ?? ''
  const list = q
    ? HISTORY.filter(
        c =>
          c.subject.toLowerCase().includes(q) ||
          c.body.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.hash.startsWith(q),
      )
    : HISTORY
  return {
    commits: list.slice(query.skip, query.skip + query.limit).map(strip),
    more: list.length > query.skip + query.limit,
    shallow: false,
  }
}

function demoShow(h: string): GitCommitDetail {
  const c = byHash(h)
  if (!c) throw new Error('找不到这个提交')
  return { commit: strip(c), from: c.parents[0] ?? null, to: c.hash, files: c.files, truncated: false }
}

function demoCompare(target: GitCompareTarget): GitCompareResult {
  // 和分支 / 标签比较（§9.6 第二期）：演示里按「本分支相对 main」给一份
  const kind = typeof target === 'string' ? target : 'base'
  const pick = { outgoing: ['a1b2c3d4e5f6', 'c9'], incoming: ['e1'], base: ['a1b2c3d4e5f6', 'c9', 'c8', 'c7'] }[kind]
  const files = new Map<string, GitCommitFile>()
  for (const id of [...pick].reverse()) for (const f of byHash(hash(id))!.files) files.set(f.path, f)
  return {
    from: hash(kind === 'base' ? 'b3' : 'c8'),
    to: hash(kind === 'incoming' ? 'e1' : 'a1b2c3d4e5f6'),
    files: [...files.values()],
    truncated: false,
    commits: pick.length,
  }
}

function demoCommitDiff(input: { path: string }): GitDiff {
  const { path } = input
  if (path.endsWith('.png')) return { path, original: null, modified: null, binary: true, tooLarge: false }
  if (path.endsWith('.css'))
    return {
      path,
      original: '.form {\n  display: grid;\n  gap: 8px;\n}\n\n.form + .form {\n  margin-top: 12px;\n}\n',
      modified:
        '.form {\n  display: grid;\n  gap: 12px;\n}\n\n.form + .form {\n  margin-top: 24px;\n  padding-top: 16px;\n  border-top: 1px solid var(--line);\n}\n',
      binary: false,
      tooLarge: false,
    }
  return demoGitDiff(path)
}

export const demoGitHistory = {
  refs: {
    head: hash('a1b2c3d4e5f6'),
    branch: 'feat/settings-form',
    upstream: 'origin/feat/settings-form',
    base: 'main',
    local: ['feat/settings-form', 'main', 'pixelsky/review-ui'],
    remote: ['origin/feat/settings-form', 'origin/main', 'origin/release/0.1'],
    tags: ['v0.1.0', 'v0.2.0'],
  } satisfies GitRefs,
  log: demoLog,
  show: demoShow,
  compare: demoCompare,
  diff: demoCommitDiff,
}
