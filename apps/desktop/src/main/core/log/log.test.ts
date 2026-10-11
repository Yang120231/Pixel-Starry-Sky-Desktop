// 日志文件和日志服务（docs/ui/logging.md §4.2–§4.4）
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { logTime, type LogEntry } from '@pixelsky/protocol'
import { LogFiles } from './files'
import { LogService, VERBOSE_MS } from './service'
import { logHostEvent } from './host-events'
import { setLogSink } from '@pixelsky/engine'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pixelsky-log-'))
})
afterEach(() => {
  setLogSink(null)
  rmSync(dir, { recursive: true, force: true })
})

const DAY = 86_400_000
const t0 = Date.parse('2026-10-11T12:00:00')
const day = (ts: number) => logTime(ts).slice(0, 10)

describe('日志文件', () => {
  it('按天写文件，超过上限换编号，接着已有的文件写', async () => {
    const files = new LogFiles({ dir, maxFileBytes: 30, now: () => t0 })
    files.append(t0, 'a'.repeat(20))
    files.append(t0, 'b'.repeat(20))
    files.append(t0 + DAY, 'next day')
    await files.flush()
    expect(readdirSync(dir).sort()).toEqual(
      [`main-${day(t0)}.1.log`, `main-${day(t0)}.log`, `main-${day(t0 + DAY)}.log`].sort(),
    )
    expect(readFileSync(join(dir, `main-${day(t0)}.1.log`), 'utf8')).toBe('b'.repeat(20) + '\n')
    // 重启后接着最后一个编号写
    const again = new LogFiles({ dir, maxFileBytes: 30, now: () => t0 })
    again.append(t0, 'c')
    await again.flush()
    expect(readFileSync(join(dir, `main-${day(t0)}.1.log`), 'utf8')).toBe('b'.repeat(20) + '\nc\n')
  })

  it('启动时删掉 7 天前的；总量超过上限从最旧的删起；不认识的文件不动', () => {
    const old = join(dir, `main-${day(t0 - 8 * DAY)}.log`)
    const mid = join(dir, `main-${day(t0 - 3 * DAY)}.log`)
    const recent = join(dir, `main-${day(t0 - DAY)}.log`)
    writeFileSync(old, 'x')
    writeFileSync(mid, 'y'.repeat(60))
    writeFileSync(recent, 'z'.repeat(60))
    writeFileSync(join(dir, 'settings.json'), '{}')
    utimesSync(old, new Date(t0), new Date(t0))
    new LogFiles({ dir, maxTotalBytes: 100, now: () => t0 })
    expect(readdirSync(dir).sort()).toEqual(['settings.json', `main-${day(t0 - DAY)}.log`].sort())
  })

  it('读：取符合条件的最新几条，跨文件，按时间先后', async () => {
    const svc = new LogService({ dir, now: () => t0 })
    const files = svc.files
    files.append(t0 - DAY, `${logTime(t0 - DAY)} WARN gateway 昨天 {"sessionId":"s1"}`)
    files.append(t0, `${logTime(t0)} INFO app 今天`)
    files.append(t0 + 1, `${logTime(t0 + 1)} ERROR session 出错 {"sessionId":"s1"}`)
    const all = await svc.read({})
    expect(all.map(e => e.message)).toEqual(['昨天', '今天', '出错'])
    expect((await svc.read({ limit: 2 })).map(e => e.message)).toEqual(['今天', '出错'])
    expect((await svc.read({ minLevel: 'warn', sessionId: 's1' })).map(e => e.message)).toEqual(['昨天', '出错'])
    expect((await svc.read({ since: t0 })).map(e => e.message)).toEqual(['今天', '出错'])
  })
})

describe('日志服务', () => {
  it('写入前脱敏；默认不记 debug，详细日志打开 24 小时，到期自动关闭，重启后保留', async () => {
    let now = t0
    const svc = new LogService({ dir, now: () => now })
    const live: LogEntry[] = []
    svc.subscribe(e => live.push(e))
    svc.write('info', 'account', '刷新失败 Bearer abc.def', { refreshToken: 'r1', status: 401 })
    svc.write('debug', 'gateway', '不记')
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({
      message: '刷新失败 [redacted]',
      fields: { refreshToken: '***', status: 401 },
    })

    expect(svc.setVerbose(true).verboseUntil).toBe(t0 + VERBOSE_MS)
    svc.write('debug', 'gateway', '记下')
    expect(live.at(-1)?.message).toBe('记下')
    expect(new LogService({ dir, now: () => now }).settings().verboseUntil).toBe(t0 + VERBOSE_MS)

    now = t0 + VERBOSE_MS + 1
    expect(svc.enabled('debug')).toBe(false)
    expect(svc.settings().verboseUntil).toBeNull()

    const text = (await svc.read({})).map(e => e.message)
    expect(text).toEqual(['刷新失败 [redacted]', '记下'])
  })

  it('会话事件：重试和失败记 warn，错误提示记 error，正常结束记 info', () => {
    const svc = new LogService({ dir, now: () => t0 })
    setLogSink(svc)
    const got: LogEntry[] = []
    svc.subscribe(e => got.push(e))
    const session = (event: unknown) =>
      logHostEvent({ kind: 'session', sessionId: 's1', seq: 1, event } as Parameters<typeof logHostEvent>[0])
    session({
      type: 'request_retry',
      retry: { turnId: 't1', attempt: 3, maxRetries: 10, retryAt: null, reason: 'Connection dropped (ECONNRESET)' },
    })
    session({ type: 'request_retry', retry: null })
    session({ type: 'item_completed', item: { kind: 'notice', id: 'n', level: 'error', text: 'API Error: 499' } })
    session({ type: 'item_completed', item: { kind: 'notice', id: 'i', level: 'info', text: '压缩' } })
    session({ type: 'turn_completed', turnId: 't1', outcome: 'failed', error: 'API Error: 499' })
    session({
      type: 'turn_completed',
      turnId: 't2',
      outcome: 'completed',
      error: null,
      usage: { durationMs: 5, models: {} },
    })
    expect(got.map(e => [e.level, e.message])).toEqual([
      ['warn', '请求重试'],
      ['error', '错误提示'],
      ['warn', '一轮失败'],
      ['info', '一轮结束'],
    ])
    expect(got[0].fields).toMatchObject({
      sessionId: 's1',
      turnId: 't1',
      attempt: 3,
      reason: 'Connection dropped (ECONNRESET)',
    })
    expect(got[3].fields).toMatchObject({ outcome: 'completed', durationMs: 5 })
  })
})
