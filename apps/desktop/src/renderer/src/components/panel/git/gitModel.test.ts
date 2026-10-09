import { afterEach, describe, expect, it } from 'vitest'
import { setCurrentLocale } from '../../../i18n/core'
import type { GitFileChange, GitStatus } from '../../../../../preload/project-tools'
import { ago, diffMode, gitSections, needsCommitAll, neighbour, splitPath } from './gitModel'

afterEach(() => setCurrentLocale('zh-CN'))
const f = (path: string, code: GitFileChange['code'] = 'M'): GitFileChange => ({ path, origPath: null, code, local: path, submodule: false })
const status = (patch: Partial<GitStatus>): GitStatus => ({ repo: true, missing: false, root: 'r', branch: 'main', detached: false, head: 'h', initial: false, upstream: null, ahead: 0, behind: 0, remotes: [],
  staged: [], unstaged: [], untracked: [], conflicted: [], truncated: false, operation: null, fetchedAt: null, busySessions: 0, ...patch })

describe('Git 面板显示规则', () => {
  it('分组顺序：冲突 → 暂存 → 更改 → 未跟踪，空组不显示；在分组之间切换文件', () => {
    const s = status({ conflicted: [f('c', 'U')], staged: [f('a')], untracked: [f('n', '?')] })
    const sections = gitSections(s)
    expect(sections.map(x => x.area)).toEqual(['conflicted', 'staged', 'untracked'])
    expect(neighbour(sections, 'staged', 'a', 1)?.file.path).toBe('n')
    expect(neighbour(sections, 'staged', 'a', -1)?.area).toBe('conflicted')
    expect(neighbour(sections, 'untracked', 'n', 1)).toBeNull()
  })
  it('没有暂存但有改动时提交全部', () => {
    expect(needsCommitAll(status({ unstaged: [f('a')] }))).toBe(true)
    expect(needsCommitAll(status({ staged: [f('a')], unstaged: [f('b')] }))).toBe(false)
    expect(needsCommitAll(status({}))).toBe(false)
  })
  it('面板窄于 560px 时只能行内显示', () => {
    expect(diffMode('split', 800)).toBe('split')
    expect(diffMode('split', 400)).toBe('inline')
    expect(diffMode('inline', 800)).toBe('inline')
  })
  it('路径拆分与「多久之前」', () => {
    expect(splitPath('src/a/b.ts')).toEqual({ name: 'b.ts', dir: 'src/a' })
    expect(splitPath('b.ts')).toEqual({ name: 'b.ts', dir: '' })
    const now = 10_000_000
    expect(ago(now - 10_000, now)).toBe('刚刚')
    expect(ago(now - 6 * 60_000, now)).toBe('6 分钟前')
    setCurrentLocale('en-US')
    expect(ago(now - 2 * 3600_000, now)).toBe('2 h ago')
  })
})
