import { describe, expect, it } from 'vitest'
import { classifyGitError, localPath, parseStatusV2 } from './git-parse'

const z = (...entries: string[]) => entries.join('\0') + '\0'

describe('git status --porcelain=v2 解析', () => {
  it('分支头：普通、上游领先落后、首次提交、分离 HEAD', () => {
    const normal = parseStatusV2(
      z('# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1'),
      '',
    )
    expect(normal).toMatchObject({
      head: 'abc123',
      branch: 'main',
      detached: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      initial: false,
    })
    expect(parseStatusV2(z('# branch.oid (initial)', '# branch.head main'), '')).toMatchObject({
      head: null,
      initial: true,
      upstream: null,
      ahead: 0,
    })
    expect(parseStatusV2(z('# branch.oid def456', '# branch.head (detached)'), '')).toMatchObject({
      branch: null,
      detached: true,
    })
  })
  it('X / Y 分开：同一个文件可以同时在暂存和更改；改名带原路径；冲突、未跟踪、子模块、带空格的路径', () => {
    const out = parseStatusV2(
      z(
        '1 MM N... 100644 100644 100644 aaa bbb src/a b.ts',
        '2 R. N... 100644 100644 100644 aaa bbb R100 docs/新.md',
        'docs/旧.md',
        '1 .D N... 100644 100644 000000 aaa aaa gone.txt',
        'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
        '1 .M S.M. 160000 160000 160000 aaa aaa vendor/lib',
        '? 新文件 1.txt',
      ),
      '',
    )
    expect(out.staged).toEqual([
      { path: 'src/a b.ts', origPath: null, code: 'M', submodule: false, local: 'src/a b.ts' },
      { path: 'docs/新.md', origPath: 'docs/旧.md', code: 'R', submodule: false, local: 'docs/新.md' },
    ])
    expect(out.unstaged.map(f => [f.path, f.code, f.submodule])).toEqual([
      ['src/a b.ts', 'M', false],
      ['gone.txt', 'D', false],
      ['vendor/lib', 'M', true],
    ])
    expect(out.conflicted).toEqual([
      { path: 'conflict.ts', origPath: null, code: 'U', submodule: false, local: 'conflict.ts' },
    ])
    expect(out.untracked).toEqual([
      { path: '新文件 1.txt', origPath: null, code: '?', submodule: false, local: '新文件 1.txt' },
    ])
  })
  it('工作区是仓库子目录时，只有子目录内的文件有本地路径', () => {
    expect(localPath('web/src/a.ts', 'web/')).toBe('src/a.ts')
    expect(localPath('server/a.ts', 'web/')).toBeNull()
    expect(localPath('a.ts', '')).toBe('a.ts')
    const out = parseStatusV2(z('? web/x.txt', '? other/y.txt'), 'web/')
    expect(out.untracked.map(f => f.local)).toEqual(['x.txt', null])
  })
  it('超过上限时截断并标记', () => {
    const out = parseStatusV2(z('? a', '? b', '? c'), '', 2)
    expect(out.untracked).toHaveLength(2)
    expect(out.truncated).toBe(true)
  })
})

describe('git 失败分类', () => {
  const kind = (stderr: string, action: Parameters<typeof classifyGitError>[1]['action'] = 'push') =>
    classifyGitError(stderr, { action }).kind
  it('远端相关', () => {
    expect(kind(' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs')).toBe('rejected')
    expect(kind('fatal: Not possible to fast-forward, aborting.', 'pull')).toBe('diverged')
    expect(kind("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe('auth')
    expect(kind("fatal: unable to access 'https://x/': The requested URL returned error: 401")).toBe('auth')
    expect(kind('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.')).toBe(
      'auth',
    )
    expect(kind("fatal: unable to access 'https://127.0.0.1:9/x.git/': Failed to connect to 127.0.0.1 port 9")).toBe(
      'network',
    )
    expect(kind('ssh: Could not resolve hostname nowhere: Name or service not known')).toBe('network')
    expect(kind('fatal: The current branch topic has no upstream branch.')).toBe('noUpstream')
  })
  it('本地相关', () => {
    expect(kind("fatal: Unable to create 'D:/r/.git/index.lock': File exists.", 'commit')).toBe('locked')
    expect(kind('CONFLICT (content): Merge conflict in a.txt', 'pull')).toBe('conflict')
    expect(kind('error: Your local changes to the following files would be overwritten by merge:', 'pull')).toBe(
      'dirty',
    )
    expect(kind('Author identity unknown\n*** Please tell me who you are.', 'commit')).toBe('identity')
    expect(kind("fatal: 'main' is already used by worktree at 'D:/copy'", 'switch')).toBe('worktree')
    expect(kind('nothing to commit, working tree clean', 'commit')).toBe('nothing')
    expect(kind('something unexpected', 'commit')).toBe('unknown')
  })
  it('超时、找不到 git、处理办法', () => {
    expect(classifyGitError('', { action: 'push', timedOut: true })).toMatchObject({
      kind: 'timeout',
      remedies: ['retry', 'terminal'],
    })
    expect(classifyGitError('spawn git ENOENT', { action: 'push', missing: true }).kind).toBe('missing')
    expect(classifyGitError('error: Your local changes would be overwritten', { action: 'pull' }).remedies).toEqual([
      'pullStash',
    ])
    expect(classifyGitError(' ! [rejected] (non-fast-forward)', { action: 'push' }).remedies).toEqual([
      'pullRebase',
      'retry',
    ])
    expect(classifyGitError('x'.repeat(5000), { action: 'push' }).detail).toHaveLength(4000)
  })
})
