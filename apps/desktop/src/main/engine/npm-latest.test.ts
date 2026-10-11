import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))

const { npmLatest, parseLatest } = await import('./npm-latest')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => mocks.fetch.mockReset())

describe('查 npm 上的最新版本', () => {
  it('只认 x.y.z（可带后缀）', () => {
    expect(parseLatest({ version: '2.1.300' })).toBe('2.1.300')
    expect(parseLatest({ version: '0.171.0-alpha.2' })).toBe('0.171.0-alpha.2')
    for (const body of [null, {}, { version: 3 }, { version: 'latest' }, { version: '1.2' }])
      expect(parseLatest(body)).toBeNull()
  })

  it('读 /<包名>/latest，npmjs.org 失败时退到 npmmirror', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(json({ version: '0.171.0' }))
    await expect(npmLatest('@openai/codex')).resolves.toBe('0.171.0')
    expect(mocks.fetch.mock.calls.map(c => c[0])).toEqual([
      'https://registry.npmjs.org/@openai/codex/latest',
      'https://registry.npmmirror.com/@openai/codex/latest',
    ])
  })

  it('两个源都不行时返回 null；不合法的包名不发请求', async () => {
    mocks.fetch.mockResolvedValue(json({ error: 'not found' }, 404))
    await expect(npmLatest('@anthropic-ai/claude-code')).resolves.toBeNull()
    mocks.fetch.mockClear()
    await expect(npmLatest('../../etc')).resolves.toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
