// 刷新登录的排队和凭据时间（docs/ui/claude-login-recovery.md §1 第 2、3 条）
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeLoginTimes, describeLoginTimes, parseLoginTimes, type ClaudeLoginTimes } from '../src/claude/credentials'
import { LOGIN_FRESH_MARGIN_MS, LOGIN_WARMUP_COOLDOWN_MS, LoginGate } from '../src/claude/login-gate'
import { makeTmp, removeTmp } from './helpers/tmp'

describe('凭据时间', () => {
  it('只取两个到期时间和有没有刷新凭据，不带凭据本身', () => {
    const t = parseLoginTimes(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'secret-a',
          refreshToken: 'secret-r',
          expiresAt: 1000,
          refreshTokenExpiresAt: 2000,
        },
      }),
    )
    expect(t).toEqual({ signedIn: true, expiresAt: 1000, refreshExpiresAt: 2000 })
    expect(JSON.stringify(t)).not.toContain('secret')
  })

  it('凭据被 Claude Code 清空、API Key 登录、坏文件都算没登录', () => {
    const cleared = { claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } }
    expect(parseLoginTimes(JSON.stringify(cleared))).toEqual({
      signedIn: false,
      expiresAt: null,
      refreshExpiresAt: null,
    })
    expect(parseLoginTimes('{}').signedIn).toBe(false)
    expect(parseLoginTimes('not json').signedIn).toBe(false)
  })

  describe('读文件', () => {
    let dir: string
    beforeEach(() => (dir = makeTmp('login-times')))
    afterEach(() => removeTmp(dir))

    it('读配置目录里的 .credentials.json；没有文件当没登录，macOS 读不到返回 null', () => {
      expect(claudeLoginTimes(dir, 'win32')).toEqual({ signedIn: false, expiresAt: null, refreshExpiresAt: null })
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { refreshToken: 'r', expiresAt: 5 } }),
      )
      expect(claudeLoginTimes(dir, 'win32')).toEqual({ signedIn: true, expiresAt: 5, refreshExpiresAt: null })
      expect(claudeLoginTimes(dir, 'darwin')).toBeNull()
    })
  })

  it('写日志的样子：到期时间和距现在多少分钟', () => {
    const now = Date.UTC(2026, 9, 24, 8, 0)
    expect(describeLoginTimes({ signedIn: true, expiresAt: now - 30 * 60_000, refreshExpiresAt: null }, now)).toEqual({
      signedIn: true,
      access: { at: '2026-10-24T07:30:00.000Z', inMin: -30 },
      refresh: null,
    })
    expect(describeLoginTimes(null)).toEqual({ credentials: 'keychain' })
  })
})

describe('LoginGate', () => {
  let now = 1_000_000
  let times: ClaudeLoginTimes | null = null
  const clock = () => now
  const gate = (waitMs = 50) => new LoginGate(() => times, clock, waitMs)
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>(r => (resolve = r))
    return { promise, resolve }
  }
  beforeEach(() => {
    now = 1_000_000
    times = null
  })

  it('访问凭据还早：不排队', async () => {
    times = { signedIn: true, expiresAt: now + LOGIN_FRESH_MARGIN_MS + 1000, refreshExpiresAt: null }
    let warmed = 0
    expect(await gate().before('/c', async () => void warmed++)).toBe('skip')
    expect(warmed).toBe(0)
  })

  it('快过期：只有第一个起预热，其他的等它', async () => {
    times = { signedIn: true, expiresAt: now + 60_000, refreshExpiresAt: null }
    const g = gate(5_000)
    const warm = deferred()
    let warmed = 0
    const first = g.before('/c', () => {
      warmed++
      return warm.promise
    })
    const second = g.before('/c', async () => void warmed++)
    let settled = false
    void second.then(() => (settled = true))
    await new Promise(r => setTimeout(r, 10))
    expect(settled).toBe(false)
    warm.resolve()
    expect(await first).toBe('warmed')
    expect(await second).toBe('waited')
    expect(warmed).toBe(1)
  })

  it('等到上限还没做完：照常起，不一直卡着；预热失败也不抛', async () => {
    times = { signedIn: true, expiresAt: now - 1000, refreshExpiresAt: null }
    const g = gate(20)
    const never = new Promise<void>(() => undefined)
    expect(await g.before('/c', () => never)).toBe('timeout')
    expect(await gate().before('/d', () => Promise.reject(new Error('boom')))).toBe('warmed')
  })

  it('预热过之后冷却期内不再预热（刷新失败时不反复起进程）', async () => {
    times = { signedIn: true, expiresAt: now - 1000, refreshExpiresAt: null }
    const g = gate()
    let warmed = 0
    await g.before('/c', async () => void warmed++)
    expect(await g.before('/c', async () => void warmed++)).toBe('skip')
    now += LOGIN_WARMUP_COOLDOWN_MS + 1
    await g.before('/c', async () => void warmed++)
    expect(warmed).toBe(2)
  })

  it('不同目录（不同账号）各排各的', async () => {
    times = { signedIn: true, expiresAt: now - 1000, refreshExpiresAt: null }
    const g = gate()
    const seen: string[] = []
    await Promise.all([
      g.before('/a', async () => void seen.push('a')),
      g.before('/b', async () => void seen.push('b')),
    ])
    expect(seen.sort()).toEqual(['a', 'b'])
  })

  it('没登录 / 凭据被清空：不排队', async () => {
    times = { signedIn: false, expiresAt: null, refreshExpiresAt: null }
    expect(gate().needs('/c')).toBe(false)
  })

  it('读不到到期时间（macOS）：arm 之后排一次，唤醒再 arm 再排一次', async () => {
    times = null
    const g = gate()
    expect(g.needs('/c')).toBe(false)
    g.arm()
    let warmed = 0
    await g.before('/c', async () => void warmed++)
    expect(await g.before('/c', async () => void warmed++)).toBe('skip')
    now += LOGIN_WARMUP_COOLDOWN_MS + 1
    expect(g.needs('/c')).toBe(false)
    g.arm()
    await g.before('/c', async () => void warmed++)
    expect(warmed).toBe(2)
  })
})
