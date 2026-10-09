import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '@pixelsky/protocol'
import { ClaudeTranslator } from '../src/claude/translate'

function make() {
  const events: EngineEvent[] = []
  const translator = new ClaudeTranslator('D:/work', {
    emit: e => events.push(e),
    sessionId: () => {},
    permissionMode: () => {},
    turnEnded: () => {},
    fastState: () => {},
  })
  translator.startTurn('turn')
  const requests = () => events.filter(e => e.type === 'request_usage')
  return { events, translator, requests }
}
const usage = (input: unknown = 10000, read: unknown = 0, write: unknown = 0) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})
const start = (id: string, data: unknown, parent: string | null = null) => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'message_start', message: { id, model: 'opus', usage: data } },
})
afterEach(() => vi.restoreAllMocks())

describe('单次请求缓存事件', () => {
  it('流式及完整消息去重，子智能体、回放和累计结果不当成新请求', () => {
    const { translator: t, requests } = make()
    t.handle(start('one', usage()))
    t.handle({ type: 'assistant', message: { id: 'one', model: 'opus', usage: usage(), content: [] } })
    t.handle(start('sub', usage(), 'tool-agent'))
    t.handle({ ...start('replay', usage()), isReplay: true })
    t.handle({
      type: 'result',
      subtype: 'success',
      modelUsage: { opus: { inputTokens: 40000, cacheReadInputTokens: 0 } },
    })
    t.handle(start('late', usage()))
    expect(requests()).toHaveLength(1)
    expect(requests()[0]).toMatchObject({ request: { messageId: 'one', input: 10000, cacheRead: 0, turnId: 'turn' } })
  })
  it('缺失、null、无效数据明确重置，不用零兜底', () => {
    const { translator: t, requests, events } = make()
    for (const [id, data] of [
      ['a', { input_tokens: 10000 }],
      ['b', usage(10000, null)],
      ['c', usage(10000, -1)],
      ['d', usage(NaN)],
      ['e', usage(1.5)],
    ] as const)
      t.handle(start(id, data))
    expect(requests()).toHaveLength(0)
    expect(events.some(e => e.type === 'request_cache_reset')).toBe(true)
  })
  it('零占位等待完整计数，增量补齐后只报告一次', () => {
    const { translator: t, requests } = make()
    t.handle(start('zero', usage(0, 0, 0)))
    expect(requests()).toHaveLength(0)
    t.handle({ type: 'stream_event', event: { type: 'message_delta', usage: usage(2000, 8000, 300) } })
    expect(requests()).toHaveLength(1)
    expect(requests()[0]).toMatchObject({ request: { input: 2000, cacheRead: 8000, cacheWrite: 300 } })
  })
  it('完整消息兜底，后到的旧消息不回写当前请求基线', () => {
    const { translator: t, requests } = make()
    t.handle(start('old', { input_tokens: 10000 }))
    t.handle(start('new', usage(12000)))
    t.handle({ type: 'assistant', message: { id: 'old', model: 'opus', usage: usage(10000), content: [] } })
    t.handle({ type: 'assistant', message: { id: 'fallback', model: 'opus', usage: usage(14000), content: [] } })
    expect(requests()).toHaveLength(2)
    expect(requests().map(e => e.request.messageId)).toEqual(['new', 'fallback'])
  })
  it('压缩和新进程重置，轮次结束后不会再报告', () => {
    const { translator: t, events, requests } = make()
    t.handle(start('one', usage()))
    t.handle({ type: 'system', subtype: 'compact_boundary' })
    t.resetUsageBaseline()
    expect(events.filter(e => e.type === 'request_cache_reset')).toHaveLength(2)
    t.interruptTurn()
    t.handle(start('late', usage()))
    expect(requests()).toHaveLength(1)
  })
})
