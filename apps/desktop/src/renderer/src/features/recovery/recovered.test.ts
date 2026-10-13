import { describe, expect, it } from 'vitest'
import { parseRecovered } from './recovered'

describe('崩溃恢复的地址参数', () => {
  it('读出原因和次数', () => {
    expect(parseRecovered('?recovered=oom&n=2')).toEqual({ reason: 'oom', n: 2 })
  })
  it('没有参数是正常启动', () => {
    expect(parseRecovered('')).toBeNull()
    expect(parseRecovered('?n=2')).toBeNull()
  })
  it('次数缺失或不合理按 1', () => {
    expect(parseRecovered('?recovered=crashed')).toEqual({ reason: 'crashed', n: 1 })
    expect(parseRecovered('?recovered=crashed&n=-3')).toEqual({ reason: 'crashed', n: 1 })
    expect(parseRecovered('?recovered=crashed&n=abc')).toEqual({ reason: 'crashed', n: 1 })
  })
})
