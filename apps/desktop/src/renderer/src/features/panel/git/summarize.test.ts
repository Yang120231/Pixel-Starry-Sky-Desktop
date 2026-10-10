// 顶栏分支与新任务起点用的 Git 摘要（docs/ui/workbench-ux-3.md §2.1）
import { describe, expect, it } from 'vitest'
import type { GitFileChange, GitStatus } from '../../../../../shared/types/project-tools'
import { summarize } from './summarize'

const change = (path: string): GitFileChange => ({ path, origPath: null, code: 'M', local: path, submodule: false })
const status = (patch: Partial<GitStatus>): GitStatus => ({
  repo: true,
  missing: false,
  root: 'D:/p',
  branch: 'main',
  detached: false,
  head: 'abcdef1234567890',
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
  ...patch,
})

describe('Git 摘要', () => {
  it('改动按文件数算：部分暂存的文件只算一次', () => {
    const s = summarize(
      status({
        staged: [change('a.ts')],
        unstaged: [change('a.ts'), change('b.ts')],
        untracked: [change('c.ts')],
        conflicted: [change('d.ts')],
      }),
    )
    expect(s).toEqual({ branch: 'main', detached: false, head: 'abcdef1234567890', changed: 4 })
  })

  it('分离的 HEAD 带上 hash；不是仓库时没有摘要', () => {
    expect(summarize(status({ branch: null, detached: true }))).toMatchObject({
      detached: true,
      head: 'abcdef1234567890',
    })
    expect(summarize(status({ repo: false }))).toBeNull()
  })
})
