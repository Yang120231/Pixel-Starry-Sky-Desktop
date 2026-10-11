// 设置 › 日志的纯函数（docs/ui/logging.md §3.1）
import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@pixelsky/protocol'
import { MAX_ENTRIES, appendLive, recentProblems, remaining, scopesOf, shortTime } from './logView'

const at = Date.parse('2026-10-11T09:30:05')
const entry = (level: LogEntry['level'], scope: string, message: string, ts = at): LogEntry => ({
  ts,
  level,
  scope,
  message,
})

describe('日志页', () => {
  it('实时条目符合条件才追加，超出上限丢最旧的', () => {
    const list = [entry('info', 'app', 'a')]
    expect(appendLive(list, entry('debug', 'gateway', 'b'), { minLevel: 'warn' })).toBe(list)
    expect(appendLive(list, entry('warn', 'gateway', 'c'), { minLevel: 'warn' }).map(e => e.message)).toEqual([
      'a',
      'c',
    ])
    const full = Array.from({ length: MAX_ENTRIES }, (_, i) => entry('info', 'app', String(i)))
    const next = appendLive(full, entry('info', 'app', 'new'), {})
    expect(next).toHaveLength(MAX_ENTRIES)
    expect(next[0].message).toBe('1')
    expect(next.at(-1)?.message).toBe('new')
  })

  it('模块下拉：常见模块在前，读到的追加，选中的一定在', () => {
    const scopes = scopesOf([entry('info', 'custom', 'x'), entry('info', '-', 'y')], 'picked')
    expect(scopes.slice(0, 3)).toEqual(['app', 'gateway', 'session'])
    expect(scopes).toContain('custom')
    expect(scopes).toContain('picked')
    expect(scopes).not.toContain('-')
  })

  it('复制最近的错误：只要警告和错误，日志行格式', () => {
    const lines = recentProblems([entry('info', 'app', 'ok'), entry('error', 'gateway', '断开')])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/ ERROR gateway 断开$/)
  })

  it('时间：今天只显示时分秒；剩余时间按分钟向上取整', () => {
    expect(shortTime(at, at)).toBe('09:30:05')
    expect(shortTime(at, at + 86_400_000)).toBe('10-11 09:30:05')
    expect(remaining(null, at)).toBeNull()
    expect(remaining(at, at)).toBeNull()
    expect(remaining(at + 90 * 60_000 + 1, at)).toEqual([1, 31])
  })
})
