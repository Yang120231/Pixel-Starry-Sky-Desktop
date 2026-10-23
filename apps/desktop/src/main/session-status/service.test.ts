import { describe, expect, it } from 'vitest'
import type { SessionStatusState } from '../../shared/types/session-status'
import type { SessionLite } from './folders'
import type { GhResult } from './gh'
import { createsPr } from './github'
import { LOOKUPS_PER_CYCLE, SessionStatusService, type PrLinks, type RestResponse } from './service'

const ok = (stdout: string): GhResult => ({ code: 0, stdout, stderr: '', missing: false, timedOut: false })
const fail = (code = 1): GhResult => ({ code, stdout: '', stderr: 'boom', missing: false, timedOut: false })
const missingGh: GhResult = { code: null, stdout: '', stderr: '', missing: true, timedOut: false }

const ghPr = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  state: 'OPEN',
  isDraft: false,
  mergedAt: null,
  closedAt: null,
  mergeable: 'MERGEABLE',
  additions: 1,
  deletions: 2,
  headRefName: 'feat',
  baseRefName: 'main',
  statusCheckRollup: [],
  ...extra,
})

function memoryLinks(initial: Record<string, string[]> = {}): PrLinks {
  const own: Record<string, string[]> = { ...initial }
  const mentioned: Record<string, string[]> = {}
  return {
    get: id => own[id] ?? [],
    mentioned: id => (mentioned[id] ?? []).filter(u => !(own[id] ?? []).includes(u)),
    add: (id, urls, isOwn = false) => {
      const box = isOwn ? own : mentioned
      const before = box[id] ?? []
      const next = [...before, ...urls.filter(u => !before.includes(u))]
      box[id] = next
      return isOwn && next.length !== before.length
    },
    retain: () => undefined,
  }
}

interface Setup {
  sessions?: SessionLite[]
  git?: Record<string, string | null>
  gh?: (args: string[]) => GhResult
  rest?: (url: string) => RestResponse | null
  links?: Record<string, string[]>
  exists?: (path: string) => boolean
  now?: () => number
}

function setup(o: Setup = {}) {
  const broadcasts: SessionStatusState[] = []
  const gitCalls: string[][] = []
  const ghCalls: string[][] = []
  const restCalls: string[] = []
  const sessions = o.sessions ?? [{ id: 's1', cwd: '/repo', archived: false }]
  let clock = 1_000_000
  const service = new SessionStatusService({
    sessions: () => sessions,
    folderExists: async p => (o.exists ? o.exists(p) : true),
    git: async (cwd, args) => {
      gitCalls.push([cwd, ...args])
      const key = args.join(' ')
      return key in (o.git ?? {}) ? o.git![key] : null
    },
    runGh: async args => {
      ghCalls.push(args)
      return o.gh ? o.gh(args) : missingGh
    },
    fetchJson: async url => {
      restCalls.push(url)
      return o.rest ? o.rest(url) : null
    },
    links: memoryLinks(o.links),
    broadcast: s => broadcasts.push(s),
    now: o.now ?? (() => (clock += 1000)),
  })
  return { service, broadcasts, gitCalls, ghCalls, restCalls }
}

const gitOk = {
  'branch --show-current': 'feat',
  'remote get-url origin': 'git@github.com:o/r.git',
  'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
}

describe('SessionStatusService folders', () => {
  it('broadcasts only when the state changes', async () => {
    let present = true
    const { service, broadcasts } = setup({ exists: () => present })
    await service.refreshFolders()
    expect(broadcasts).toHaveLength(1)
    expect(service.state().missingFolders).toEqual({})
    await service.refreshFolders()
    expect(broadcasts).toHaveLength(1)
    present = false
    await service.refreshFolders()
    expect(broadcasts).toHaveLength(2)
    expect(broadcasts[1].missingFolders).toEqual({ s1: true })
    await service.refreshFolders()
    expect(broadcasts).toHaveLength(2)
  })
  it('sessionsChanged flags only new sessions or cwds', () => {
    const { service } = setup()
    expect(service.sessionsChanged()).toEqual({ folders: true, prs: true })
    expect(service.sessionsChanged()).toEqual({ folders: false, prs: false })
  })
})

describe('SessionStatusService prs via gh', () => {
  it('looks up the branch PRs and maps them', async () => {
    const { service, broadcasts, ghCalls, gitCalls } = setup({
      git: gitOk,
      gh: args =>
        args[0] === 'auth'
          ? ok('')
          : ok(
              JSON.stringify([
                ghPr(3, { mergeable: 'CONFLICTING' }),
                ghPr(2, { state: 'MERGED', mergedAt: '2026-10-10T00:00:00Z' }),
              ]),
            ),
    })
    await service.refreshPrs()
    expect(ghCalls[0]).toEqual(['auth', 'status'])
    expect(ghCalls[1].slice(0, 7)).toEqual(['pr', 'list', '--repo', 'o/r', '--head', 'feat', '--state'])
    expect(gitCalls.every(c => c[0] === '/repo')).toBe(true)
    const state = broadcasts.at(-1)!
    expect(state.gh).toBe('ready')
    expect(state.prs.s1.map(p => [p.number, p.state, p.conflict])).toEqual([
      [3, 'open', true],
      [2, 'merged', false],
    ])
    // 内容没变：再查一遍不再广播
    const count = broadcasts.length
    await service.refreshPrs(undefined, true)
    expect(broadcasts).toHaveLength(count)
  })

  it('skips detached HEAD, the default branch and non-github remotes', async () => {
    for (const git of [
      { ...gitOk, 'branch --show-current': '' },
      { ...gitOk, 'branch --show-current': 'main' },
      { ...gitOk, 'remote get-url origin': 'https://gitlab.com/o/r.git' },
      { ...gitOk, 'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/feat' },
    ]) {
      const { service, ghCalls } = setup({ git, gh: () => ok('[]') })
      await service.refreshPrs()
      expect(ghCalls.filter(a => a[0] === 'pr')).toEqual([])
    }
    // 取不到默认分支时 master 也跳过
    const { service, ghCalls } = setup({
      git: { ...gitOk, 'branch --show-current': 'master', 'symbolic-ref --short refs/remotes/origin/HEAD': null },
      gh: () => ok('[]'),
    })
    await service.refreshPrs()
    expect(ghCalls.filter(a => a[0] === 'pr')).toEqual([])
  })

  it('does not run git in a missing folder', async () => {
    const { service, gitCalls } = setup({ exists: () => false, git: gitOk, gh: () => ok('[]') })
    await service.refreshFolders()
    await service.refreshPrs()
    expect(gitCalls).toEqual([])
  })

  it('looks up linked PR urls with gh pr view, unknown when it fails', async () => {
    const url = 'https://github.com/o/r/pull/5'
    const other = 'https://github.com/p/q/pull/8'
    const { service, broadcasts } = setup({
      links: { s1: [url, other] },
      gh: args => {
        if (args[0] === 'auth') return ok('')
        if (args[2] === url)
          return ok(JSON.stringify(ghPr(5, { state: 'CLOSED', closedAt: new Date(1_000_000).toISOString() })))
        return fail()
      },
    })
    await service.refreshPrs()
    const prs = broadcasts.at(-1)!.prs.s1
    expect(prs.find(p => p.number === 5)).toMatchObject({ state: 'closed', repo: 'o/r' })
    expect(prs.find(p => p.number === 8)).toMatchObject({ unknown: true, state: 'open', repo: 'p/q', url: other })
  })

  it('reports signed-out and missing gh', async () => {
    const a = setup({ gh: () => fail() })
    await a.service.refreshPrs()
    expect(a.service.state().gh).toBe('signed-out')
    const b = setup({ gh: () => missingGh })
    await b.service.refreshPrs()
    expect(b.service.state().gh).toBe('missing')
  })

  it('re-checks gh at most every 5 minutes', async () => {
    let t = 0
    const { service, ghCalls } = setup({ gh: () => ok(''), now: () => t })
    await service.refreshPrs()
    t = 4 * 60_000
    await service.refreshPrs()
    expect(ghCalls.filter(a => a[0] === 'auth')).toHaveLength(1)
    t = 6 * 60_000
    await service.refreshPrs()
    expect(ghCalls.filter(a => a[0] === 'auth')).toHaveLength(2)
  })

  it('caps lookups per cycle', async () => {
    const urls = Array.from({ length: LOOKUPS_PER_CYCLE + 10 }, (_, i) => `https://github.com/o/r/pull/${i + 1}`)
    const { service, ghCalls } = setup({ links: { s1: urls }, gh: args => (args[0] === 'auth' ? ok('') : fail()) })
    await service.refreshPrs()
    expect(ghCalls.filter(a => a[0] === 'pr')).toHaveLength(LOOKUPS_PER_CYCLE)
  })

  it('refresh(sessionId) only touches that session', async () => {
    const { service, ghCalls } = setup({
      sessions: [
        { id: 'a', cwd: '/a', archived: false },
        { id: 'b', cwd: '/b', archived: false },
      ],
      git: gitOk,
      gh: args => (args[0] === 'auth' ? ok('') : ok('[]')),
    })
    await service.refreshPrs('a')
    expect(ghCalls.filter(a => a[0] === 'pr')).toHaveLength(1)
  })
})

describe('SessionStatusService rest fallback', () => {
  const pulls = [
    {
      number: 3,
      title: 'T',
      html_url: 'https://github.com/o/r/pull/3',
      state: 'open',
      draft: false,
      merged_at: null,
      closed_at: null,
      head: { ref: 'feat' },
      base: { ref: 'main' },
    },
  ]
  it('uses the public api without gh', async () => {
    const { service, restCalls, broadcasts } = setup({
      git: gitOk,
      links: { s1: ['https://github.com/o/r/pull/9'] },
      rest: url =>
        url.includes('/pulls?')
          ? { status: 200, body: pulls }
          : {
              status: 200,
              body: { ...pulls[0], number: 9, html_url: 'https://github.com/o/r/pull/9', mergeable_state: 'dirty' },
            },
    })
    await service.refreshPrs()
    expect(restCalls[0]).toBe('https://api.github.com/repos/o/r/pulls?head=o%3Afeat&state=all&per_page=5')
    expect(restCalls[1]).toBe('https://api.github.com/repos/o/r/pulls/9')
    const prs = broadcasts.at(-1)!.prs.s1
    expect(prs.map(p => [p.number, p.ci, p.conflict])).toEqual([
      [9, null, true],
      [3, null, false],
    ])
  })
  it('drops branch prs and marks linked prs unknown on 404, then stops after rate limit', async () => {
    const { service, restCalls, broadcasts } = setup({
      git: gitOk,
      links: { s1: ['https://github.com/o/r/pull/9'] },
      rest: () => ({ status: 403, body: null }),
    })
    await service.refreshPrs()
    expect(broadcasts.at(-1)!.prs.s1).toMatchObject([{ number: 9, unknown: true }])
    const calls = restCalls.length
    await service.refreshPrs(undefined, true)
    expect(restCalls).toHaveLength(calls) // 限流后一段时间不再请求
  })
})

describe('SessionStatusService links', () => {
  it('noteLinks: only links from creating a PR count as own and trigger a lookup', () => {
    const { service } = setup()
    expect(service.noteLinks('s1', 'done: https://github.com/o/r/pull/12 ', true)).toBe(true)
    expect(service.noteLinks('s1', 'again https://github.com/o/r/pull/12', true)).toBe(false)
    expect(service.noteLinks('s1', 'no links', true)).toBe(false)
    expect(service.noteLinks('s1', 'see https://github.com/x/y/pull/3')).toBe(false)
  })

  it('mentioned links are published without lookup, minus ones already known as own', () => {
    const { service } = setup()
    service.noteLinks('s1', 'https://github.com/o/r/pull/12', true)
    service.noteLinks('s1', 'https://github.com/o/r/pull/12 https://github.com/x/y/pull/3')
    expect(service.state().mentioned).toEqual({ s1: ['https://github.com/x/y/pull/3'] })
  })
})

describe('createsPr', () => {
  it('recognizes gh pr create and PR-creating tools', () => {
    expect(createsPr({ kind: 'command', command: 'git push -u origin x && gh pr create --fill' })).toBe(true)
    expect(createsPr({ kind: 'command', command: 'git push origin feat' })).toBe(true)
    expect(createsPr({ kind: 'command', command: 'gh pr view 12' })).toBe(false)
    expect(createsPr({ kind: 'tool', name: 'mcp__github__create_pull_request' })).toBe(true)
    expect(createsPr({ kind: 'tool', name: 'WebFetch' })).toBe(false)
  })
})
