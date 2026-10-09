// Git 面板的演示数据（docs/ui/git-panel.md），只在 `pnpm dev:demo` 显示
import type { GitBranch, GitDiff, GitFileChange, GitStatus } from '../../../shared/types/project-tools'

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
  head: 'a1b2c3d4e5f6',
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
