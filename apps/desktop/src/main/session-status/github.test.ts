import { describe, expect, it } from 'vitest'
import type { SessionPr } from '../../shared/types/session-status'
import {
  CLOSED_KEEP_MS,
  arrangePrs,
  extractPrUrls,
  mapGhPr,
  mapRestPr,
  parseGithubRemote,
  parsePrUrl,
  summarizeChecks,
  unknownPr,
} from './github'

const pr = (patch: Partial<SessionPr>): SessionPr => ({
  repo: 'o/r',
  number: 1,
  url: 'https://github.com/o/r/pull/1',
  title: 't',
  state: 'open',
  ci: null,
  ciFailed: 0,
  conflict: false,
  additions: 0,
  deletions: 0,
  head: 'h',
  base: 'main',
  closedAt: null,
  ...patch,
})

describe('parseGithubRemote', () => {
  it('reads https and ssh github.com remotes', () => {
    const want = { owner: 'xiaoheoxo', repo: 'Pixel-Starry-Sky-Desktop' }
    expect(parseGithubRemote('https://github.com/xiaoheoxo/Pixel-Starry-Sky-Desktop.git')).toEqual(want)
    expect(parseGithubRemote('https://github.com/xiaoheoxo/Pixel-Starry-Sky-Desktop')).toEqual(want)
    expect(parseGithubRemote('https://user:tok@github.com/xiaoheoxo/Pixel-Starry-Sky-Desktop.git\n')).toEqual(want)
    expect(parseGithubRemote('git@github.com:xiaoheoxo/Pixel-Starry-Sky-Desktop.git')).toEqual(want)
    expect(parseGithubRemote('ssh://git@github.com/xiaoheoxo/Pixel-Starry-Sky-Desktop.git')).toEqual(want)
    expect(parseGithubRemote('https://github.com/a/b.c.git')).toEqual({ owner: 'a', repo: 'b.c' })
  })
  it('rejects other hosts and malformed urls', () => {
    expect(parseGithubRemote('https://gitlab.com/a/b.git')).toBeNull()
    expect(parseGithubRemote('https://github.com.evil.com/a/b')).toBeNull()
    expect(parseGithubRemote('https://github.com/a')).toBeNull()
    expect(parseGithubRemote('git@bitbucket.org:a/b.git')).toBeNull()
    expect(parseGithubRemote('')).toBeNull()
  })
})

describe('extractPrUrls', () => {
  it('finds pull request links, dedupes, keeps order', () => {
    const text = [
      'Created https://github.com/o/r/pull/12',
      'see (https://github.com/o/r/pull/12). and https://github.com/x-y/z.w/pull/7#issuecomment-1',
      'issue https://github.com/o/r/issues/3 is not a pr',
      'https://github.com/o/r/pull/12/files',
    ].join('\n')
    expect(extractPrUrls(text).map(l => l.url)).toEqual([
      'https://github.com/o/r/pull/12',
      'https://github.com/x-y/z.w/pull/7',
    ])
    expect(extractPrUrls('nothing')).toEqual([])
  })
  it('parsePrUrl accepts only a bare pr url', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/5')).toMatchObject({ owner: 'o', repo: 'r', number: 5 })
    expect(parsePrUrl('see https://github.com/o/r/pull/5')).toBeNull()
  })
})

describe('summarizeChecks', () => {
  it('maps the rollup', () => {
    expect(summarizeChecks([])).toEqual({ ci: null, ciFailed: 0 })
    expect(summarizeChecks(null)).toEqual({ ci: null, ciFailed: 0 })
    expect(
      summarizeChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'SKIPPED' },
        { state: 'SUCCESS' },
      ]),
    ).toEqual({ ci: 'pass', ciFailed: 0 })
    expect(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toEqual({
      ci: 'pending',
      ciFailed: 0,
    })
    expect(summarizeChecks([{ state: 'PENDING' }])).toEqual({ ci: 'pending', ciFailed: 0 })
    expect(
      summarizeChecks([
        { status: 'COMPLETED', conclusion: 'FAILURE' },
        { status: 'COMPLETED', conclusion: 'TIMED_OUT' },
        { status: 'IN_PROGRESS' },
        { state: 'ERROR' },
      ]),
    ).toEqual({ ci: 'fail', ciFailed: 3 })
    for (const conclusion of ['CANCELLED', 'ACTION_REQUIRED'])
      expect(summarizeChecks([{ status: 'COMPLETED', conclusion }]).ci).toBe('fail')
  })
})

describe('mapGhPr', () => {
  const base = {
    number: 9,
    title: 'Fix',
    url: 'https://github.com/o/r/pull/9',
    additions: 3,
    deletions: 1,
    headRefName: 'feat',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    statusCheckRollup: [],
    mergedAt: null,
    closedAt: null,
    isDraft: false,
  }
  it('maps states', () => {
    expect(mapGhPr({ ...base, state: 'OPEN' })).toMatchObject({
      repo: 'o/r',
      number: 9,
      state: 'open',
      head: 'feat',
      base: 'main',
      additions: 3,
      deletions: 1,
      conflict: false,
      ci: null,
      closedAt: null,
    })
    expect(mapGhPr({ ...base, state: 'OPEN', isDraft: true })?.state).toBe('draft')
    expect(mapGhPr({ ...base, state: 'CLOSED', closedAt: '2026-10-01T00:00:00Z' })).toMatchObject({
      state: 'closed',
      closedAt: '2026-10-01T00:00:00Z',
    })
    // 已合并：closedAt 取 mergedAt
    expect(
      mapGhPr({
        ...base,
        state: 'MERGED',
        isDraft: true,
        mergedAt: '2026-10-02T00:00:00Z',
        closedAt: '2026-10-03T00:00:00Z',
      }),
    ).toMatchObject({ state: 'merged', closedAt: '2026-10-02T00:00:00Z' })
  })
  it('maps conflict and ci', () => {
    const m = mapGhPr({
      ...base,
      state: 'OPEN',
      mergeable: 'CONFLICTING',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
    })
    expect(m).toMatchObject({ conflict: true, ci: 'fail', ciFailed: 1 })
    expect(mapGhPr({ ...base, state: 'OPEN', mergeable: 'UNKNOWN' })?.conflict).toBe(false)
  })
  it('rejects junk', () => {
    expect(mapGhPr(null)).toBeNull()
    expect(mapGhPr({ state: 'OPEN' })).toBeNull()
  })
})

describe('mapRestPr', () => {
  const base = {
    number: 4,
    title: 'T',
    html_url: 'https://github.com/o/r/pull/4',
    state: 'open',
    draft: false,
    merged_at: null,
    closed_at: null,
    head: { ref: 'feat' },
    base: { ref: 'main' },
  }
  it('maps rest pulls', () => {
    expect(mapRestPr(base)).toMatchObject({ state: 'open', ci: null, conflict: false, head: 'feat', base: 'main' })
    expect(mapRestPr({ ...base, draft: true })?.state).toBe('draft')
    expect(mapRestPr({ ...base, state: 'closed', closed_at: '2026-10-01T00:00:00Z' })).toMatchObject({
      state: 'closed',
      closedAt: '2026-10-01T00:00:00Z',
    })
    expect(mapRestPr({ ...base, state: 'closed', merged_at: '2026-10-02T00:00:00Z' })?.state).toBe('merged')
    expect(mapRestPr({ ...base, mergeable_state: 'dirty', additions: 5, deletions: 2 })).toMatchObject({
      conflict: true,
      additions: 5,
      deletions: 2,
    })
  })
})

describe('arrangePrs', () => {
  const now = Date.parse('2026-10-16T00:00:00Z')
  it('sorts by attention and dedupes by url', () => {
    const list = arrangePrs(
      [
        pr({ number: 1, url: 'u1', state: 'closed', closedAt: '2026-10-15T00:00:00Z' }),
        pr({ number: 2, url: 'u2', state: 'merged', closedAt: '2026-10-14T00:00:00Z' }),
        pr({ number: 3, url: 'u3', state: 'draft' }),
        pr({ number: 4, url: 'u4', state: 'open' }),
        pr({ number: 5, url: 'u5', state: 'open', ci: 'fail', ciFailed: 1 }),
        pr({ number: 6, url: 'u6', state: 'open', conflict: true }),
        pr({ number: 7, url: 'u4', state: 'open' }),
      ],
      now,
    )
    expect(list.map(p => p.number)).toEqual([6, 5, 4, 3, 2, 1])
  })
  it('drops closed (not merged) older than 7 days, keeps merged', () => {
    const old = new Date(now - CLOSED_KEEP_MS - 1000).toISOString()
    const recent = new Date(now - CLOSED_KEEP_MS + 60_000).toISOString()
    const list = arrangePrs(
      [
        pr({ number: 1, url: 'a', state: 'closed', closedAt: old }),
        pr({ number: 2, url: 'b', state: 'closed', closedAt: recent }),
        pr({ number: 3, url: 'c', state: 'merged', closedAt: old }),
      ],
      now,
    )
    expect(list.map(p => p.number)).toEqual([3, 2])
  })
  it('unknownPr is an open placeholder', () => {
    expect(unknownPr({ owner: 'o', repo: 'r', number: 3, url: 'https://github.com/o/r/pull/3' })).toMatchObject({
      unknown: true,
      state: 'open',
      repo: 'o/r',
      number: 3,
    })
  })
})
