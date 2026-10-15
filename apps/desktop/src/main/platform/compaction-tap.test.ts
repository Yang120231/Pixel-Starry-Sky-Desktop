import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_COMPACT_MARKER, type CompactionRequestReport } from '@pixelsky/engine'
import { CompactionTap, compactionTap, estimateTokens } from './compaction-tap'

const compactBody = (model: string) =>
  JSON.stringify({ model, system: [{ type: 'text', text: `${CLAUDE_COMPACT_MARKER}.` }], messages: [] })
const delta = (text: string) =>
  `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
})
afterEach(() => vi.useRealTimers())

describe('压缩请求的进度', () => {
  it('只认 Claude Code 的压缩请求；没人收进度时不开', () => {
    const send = vi.fn()
    expect(compactionTap(send, compactBody('claude-haiku-4-5'), 'claude-opus-5-5')).toBeInstanceOf(CompactionTap)
    expect(send.mock.calls[0][0]).toMatchObject({
      model: 'claude-haiku-4-5',
      requestedModel: 'claude-opus-5-5',
      requestAt: 10_000,
      done: false,
    })
    expect(compactionTap(send, JSON.stringify({ model: 'm', system: 'You are Claude Code' }), 'm')).toBeNull()
    expect(compactionTap(null, compactBody('m'), 'm')).toBeNull()
    expect(compactionTap(send, `${CLAUDE_COMPACT_MARKER}{bad`, 'm')).toBeNull()
  })

  it('接通、首字立即报；输出中的 token 按字数估，节流后报；拿到用量后换成准确值', () => {
    const reports: CompactionRequestReport[] = []
    const tap = new CompactionTap(r => reports.push(r), 'm', 'm')
    vi.setSystemTime(11_000)
    tap.response(200)
    expect(reports.at(-1)).toMatchObject({ connectedAt: 11_000, status: 200 })
    vi.setSystemTime(13_000)
    tap.touch()
    tap.sse(delta('a'.repeat(40)))
    expect(reports.at(-1)).toMatchObject({ firstTokenAt: 13_000, outputTokens: 10, outputExact: false })
    const count = reports.length
    tap.sse(delta('压缩'.repeat(30)))
    expect(reports.length).toBe(count)
    vi.advanceTimersByTime(250)
    expect(reports.at(-1)).toMatchObject({ outputTokens: 50, lastContentAt: 13_000 })
    tap.sse('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":1814}}\n\n')
    tap.end()
    expect(reports.at(-1)).toMatchObject({ outputTokens: 1_814, outputExact: true, done: true, error: null })
  })

  it('上游报错：状态码加响应体里的原因；中途断开记原因；结束后不再报', () => {
    const reports: CompactionRequestReport[] = []
    const tap = new CompactionTap(r => reports.push(r), 'm', 'm')
    tap.response(529)
    tap.body(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }))
    tap.end()
    expect(reports.at(-1)).toMatchObject({ status: 529, done: true, error: 'HTTP 529 · Overloaded' })
    const count = reports.length
    tap.fail('again')
    tap.touch()
    vi.advanceTimersByTime(1_000)
    expect(reports.length).toBe(count)

    const broken: CompactionRequestReport[] = []
    const second = new CompactionTap(r => broken.push(r), 'm', 'm')
    second.response(200)
    second.sse(delta('hi'))
    second.fail('上游连接中途断开')
    expect(broken.at(-1)).toMatchObject({ done: true, error: '上游连接中途断开' })
  })

  it('SSE 里的 error 事件记下原因', () => {
    const reports: CompactionRequestReport[] = []
    const tap = new CompactionTap(r => reports.push(r), 'm', 'm')
    tap.sse('event: error\ndata: {"type":"error","error":{"type":"api_error","message":"boom"}}\n\n')
    tap.end()
    expect(reports.at(-1)?.error).toBe('boom')
  })

  it('按字数估 token', () => {
    expect(estimateTokens(400, 0)).toBe(100)
    expect(estimateTokens(0, 300)).toBe(200)
  })
})
