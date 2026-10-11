// 日志的脱敏和 sink（docs/ui/logging.md §4.3、§4.6）
import { afterEach, describe, expect, it } from 'vitest'
import { describeError, logger, redact, sanitizeFields, setLogSink, type LogLevel } from '../src/log'

afterEach(() => setLogSink(null))

describe('脱敏', () => {
  it('密钥、令牌、授权参数换成 [redacted]', () => {
    expect(redact('key sk-ant-api03-abcdefgh and pss_0123456789abc / jc_abcdefgh')).toBe(
      'key [redacted] and [redacted] / [redacted]',
    )
    expect(redact('Authorization: Bearer abc.def-ghi rest')).toBe('Authorization: [redacted] rest')
    expect(redact('https://x/authorize?client_id=a&state=s1&code_challenge=c2&token=t3#refresh_token=r4')).toBe(
      'https://x/authorize?client_id=a&state=[redacted]&code_challenge=[redacted]&token=[redacted]#refresh_token=[redacted]',
    )
    // 普通单词不误伤
    expect(redact('risk-free task_done')).toBe('risk-free task_done')
  })

  it('字段名像密钥的字符串整个换成 ***，数字不动；Error 展开；大小有上限', () => {
    const out = sanitizeFields({
      apiKey: 'abc',
      headers: { Authorization: 'Bearer x', 'x-app': 'cli' },
      inputTokens: 1200,
      refreshToken: null,
      url: 'https://a?token=zzz',
      error: Object.assign(new Error('boom'), { code: 'ECONNRESET' }),
      list: Array.from({ length: 60 }, (_, i) => i),
      long: 'x'.repeat(5000),
      skip: undefined,
    })
    expect(out.apiKey).toBe('***')
    expect(out.headers).toEqual({ Authorization: '***', 'x-app': 'cli' })
    expect(out.inputTokens).toBe(1200)
    expect(out.refreshToken).toBeNull()
    expect(out.url).toBe('https://a?token=[redacted]')
    expect(out.error).toMatchObject({ name: 'Error', message: 'boom', code: 'ECONNRESET' })
    expect((out.list as unknown[]).length).toBe(51)
    expect(String(out.long)).toMatch(/^x{4000}…（共 5000 字）$/)
    expect('skip' in out).toBe(false)
  })

  it('错误沿 cause 链取代码和说明', () => {
    const error = new TypeError('terminated', {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    })
    expect(describeError(error)).toBe('TypeError terminated ← UND_ERR_SOCKET other side closed')
    expect(describeError('plain')).toBe('plain')
  })
})

describe('sink', () => {
  it('没装 sink 时什么都不做；装上后按级别转发，sink 抛错不影响调用方', () => {
    const log = logger('test')
    log.error('dropped')
    expect(log.enabled('error')).toBe(false)
    const got: [LogLevel, string, string][] = []
    setLogSink({
      enabled: level => level !== 'debug',
      write: (level, scope, message) => {
        if (message === 'throw') throw new Error('sink failed')
        got.push([level, scope, message])
      },
    })
    log.debug('hidden')
    log.info('hello')
    expect(() => log.warn('throw')).not.toThrow()
    expect(got).toEqual([['info', 'test', 'hello']])
    expect(log.enabled('debug')).toBe(false)
  })
})
