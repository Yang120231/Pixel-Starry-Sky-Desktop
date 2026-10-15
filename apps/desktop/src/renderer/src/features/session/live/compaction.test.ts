import { describe, expect, it } from 'vitest'
import type { CompactionProgress, RequestRetryState } from '@pixelsky/protocol'
import {
  STALL_MS,
  compactionClock,
  compactionRate,
  compactionRatio,
  compactionSaved,
  compactionSoftProgress,
  compactionView,
  easeTokens,
  waitingSlow,
} from './compaction'

describe('压缩上下文的数字', () => {
  it('计时：分:秒，超过一小时带小时', () => {
    expect(compactionClock(0)).toBe('0:00')
    expect(compactionClock(7_900)).toBe('0:07')
    expect(compactionClock(102_000)).toBe('1:42')
    expect(compactionClock(3_725_000)).toBe('1:02:05')
    expect(compactionClock(-5)).toBe('0:00')
  })

  it('比例和减少的百分比：两头都知道才有；没变小不算减少', () => {
    expect(compactionRatio({ preTokens: 200_000, postTokens: 20_000 })).toBe(0.1)
    expect(compactionRatio({ preTokens: 200_000, postTokens: 100 })).toBe(0.02)
    expect(compactionRatio({ preTokens: 200_000, postTokens: null })).toBeNull()
    expect(compactionRatio({ preTokens: 0, postTokens: 0 })).toBeNull()
    expect(compactionSaved({ preTokens: 184_213, postTokens: 12_480 })).toBe(93)
    expect(compactionSaved({ preTokens: 10_000, postTokens: 12_000 })).toBeNull()
    expect(compactionSaved({ preTokens: null, postTokens: 12_000 })).toBeNull()
  })

  it('递减动画：从压缩前缓动到压缩后', () => {
    expect(easeTokens(100_000, 10_000, 0)).toBe(100_000)
    expect(easeTokens(100_000, 10_000, 1)).toBe(10_000)
    expect(easeTokens(100_000, 10_000, 2)).toBe(10_000)
    expect(easeTokens(100_000, 10_000, 0.5)).toBeLessThan(55_000)
  })
})

const progress = (patch: Partial<CompactionProgress> = {}): CompactionProgress => ({
  itemId: 'c',
  requests: 1,
  model: 'claude-haiku-4-5',
  requestedModel: 'claude-opus-5-5',
  requestAt: 1_000,
  connectedAt: null,
  status: null,
  firstTokenAt: null,
  lastContentAt: null,
  lastByteAt: null,
  outputTokens: 0,
  outputExact: false,
  done: false,
  error: null,
  ...patch,
})
const retry: RequestRetryState = { turnId: 't', attempt: 1, maxRetries: 10, retryAt: 9_000, reason: 'HTTP 502' }

describe('压缩停在哪一步', () => {
  it('没有网关进度：经过网关的是准备请求，直连的是等待模型；有重试等待时是重试中', () => {
    expect(compactionView(null, null, true, 5_000).phase).toBe('preparing')
    expect(compactionView(null, null, false, 5_000).phase).toBe('waiting')
    expect(compactionView(null, retry, false, 5_000).phase).toBe('retrying')
  })

  it('等待接通 → 模型读取对话 → 输出摘要 → 整理上下文', () => {
    expect(compactionView(progress(), null, true, 4_000)).toMatchObject({ phase: 'connecting', waitingMs: 3_000 })
    expect(compactionView(progress({ connectedAt: 1_500, status: 200 }), null, true, 6_000)).toMatchObject({
      phase: 'reading',
      waitingMs: 5_000,
    })
    const streaming = progress({
      connectedAt: 1_500,
      status: 200,
      firstTokenAt: 7_000,
      lastContentAt: 9_000,
      lastByteAt: 9_000,
    })
    expect(compactionView(streaming, null, true, 9_500)).toMatchObject({ phase: 'streaming', stalledMs: null })
    expect(compactionView({ ...streaming, done: true }, null, true, 9_500).phase).toBe('finishing')
  })

  it('网关上有请求在进行时按它的阶段显示，重试等待还没清掉也一样', () => {
    expect(compactionView(progress({ requests: 2 }), retry, true, 4_000).phase).toBe('connecting')
  })

  it('上游出错：Claude Code 报了重试就是重试中，没报就是上游出错', () => {
    const failed = progress({ status: 502, done: true, error: 'HTTP 502' })
    expect(compactionView(failed, null, true, 4_000).phase).toBe('upstreamError')
    expect(compactionView(failed, retry, true, 4_000).phase).toBe('retrying')
    expect(compactionView(progress({ connectedAt: 1_500, status: 529 }), null, true, 4_000).phase).toBe('upstreamError')
  })

  it('输出 15 秒没有新内容算停住；最近还收到数据算连接还在', () => {
    const p = progress({
      connectedAt: 1_500,
      status: 200,
      firstTokenAt: 2_000,
      lastContentAt: 3_000,
      lastByteAt: 3_000,
    })
    expect(compactionView(p, null, true, 3_000 + STALL_MS - 1).stalledMs).toBeNull()
    expect(compactionView(p, null, true, 3_000 + STALL_MS)).toMatchObject({ stalledMs: STALL_MS, heartbeat: true })
    expect(compactionView(p, null, true, 30_000)).toMatchObject({ heartbeat: false })
    expect(compactionView({ ...p, lastByteAt: 25_000 }, null, true, 30_000)).toMatchObject({ heartbeat: true })
  })

  it('比平时慢：等首字超过 25 秒且超过平时的 2.5 倍', () => {
    const at = (ms: number) => compactionView(progress(), null, true, 1_000 + ms)
    expect(waitingSlow(at(26_000), 8_000)).toBe(true)
    expect(waitingSlow(at(24_000), 8_000)).toBe(false)
    expect(waitingSlow(at(40_000), 20_000)).toBe(false)
    expect(waitingSlow(compactionView(null, null, false, 99_000), 1_000)).toBe(false)
  })

  it('软进度：没出字时不推进；输出时按平时的摘要长度，最多 92%；整理上下文 96%', () => {
    expect(compactionSoftProgress('reading', 0, 2_000)).toBeNull()
    expect(compactionSoftProgress('streaming', 1_000, 2_000)).toBe(0.5)
    expect(compactionSoftProgress('streaming', 9_000, 2_000)).toBe(0.92)
    expect(compactionSoftProgress('finishing', 0, 2_000)).toBe(0.96)
  })

  it('输出速度：首字到最近一次内容；不到一秒时不算', () => {
    expect(compactionRate(progress({ firstTokenAt: 1_000, lastContentAt: 11_000, outputTokens: 600 }))).toBe(60)
    expect(compactionRate(progress({ firstTokenAt: 1_000, lastContentAt: 1_500, outputTokens: 60 }))).toBeNull()
    expect(compactionRate(progress())).toBeNull()
  })
})
