import { describe, expect, it } from 'vitest'
import { CacheUsageFix } from './usageFix'

const usage = (input: number, read: number, write = 0) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})
const body = (u: Record<string, number>) => JSON.stringify({ type: 'message', content: [], usage: u })
/** 一个非流式请求，返回转发出去的 input_tokens */
const send = (fix: CacheUsageFix, key: string, u: Record<string, number>): number =>
  JSON.parse(fix.request(key).json(body(u))).usage.input_tokens

describe('缓存用量口径（GitHub #34）', () => {
  it('标准口径（input 只算没命中缓存的）原样不动；认定标准后，偶尔 input ≥ 缓存读也不改', () => {
    const fix = new CacheUsageFix()
    expect(send(fix, 'k', usage(120, 150_000, 800))).toBe(120)
    expect(fix.mode('k')).toBe('standard')
    expect(send(fix, 'k', usage(60_000, 20_000))).toBe(60_000)
    expect(send(fix, 'k', usage(60_000, 20_000))).toBe(60_000)
  })

  it('含缓存的口径（截图里 输入 ≈ 缓存读）：连续两个请求才认定，之后减掉缓存读写', () => {
    const fix = new CacheUsageFix()
    // 第一个请求只记一次，不改（标准口径偶尔也会这样）
    expect(send(fix, 'k', usage(155_200, 154_000))).toBe(155_200)
    expect(fix.mode('k')).toBeUndefined()
    expect(send(fix, 'k', usage(156_000, 155_000))).toBe(1_000)
    expect(fix.mode('k')).toBe('inclusive')
    expect(send(fix, 'k', usage(10_000, 6_000, 3_000))).toBe(1_000)
    // 没有缓存读的响应不用改
    expect(send(fix, 'k', usage(800, 0))).toBe(800)
  })

  it('中间夹一个标准口径的请求就从头算；认定含缓存后又见到标准口径的，改回标准', () => {
    const fix = new CacheUsageFix()
    send(fix, 'a', usage(50_000, 49_000))
    send(fix, 'a', usage(30_000, 10_000, 25_000)) // 两者之间：不下结论、清零
    send(fix, 'a', usage(50_000, 49_000))
    expect(fix.mode('a')).toBeUndefined()
    send(fix, 'a', usage(51_000, 50_000))
    expect(fix.mode('a')).toBe('inclusive')
    expect(send(fix, 'a', usage(100, 52_000))).toBe(100)
    expect(fix.mode('a')).toBe('standard')
    // 按线路 + 模型分开记
    expect(fix.mode('b')).toBeUndefined()
  })

  it('一个请求的 message_start 和 message_delta 只算一次；两处 usage 都改，别的事件逐字不动（含 CRLF）', () => {
    const fix = new CacheUsageFix()
    const stream = (input: number, read: number) =>
      `event: message_start\r\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm', usage: usage(input, read) } })}\r\n\r\n` +
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"usage"}}\r\n\r\n' +
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { ...usage(input, read), output_tokens: 9 } })}\n\n`
    // 第一个请求：两份 usage 只算一次，还没认定
    const first = fix.request('k')
    expect(first.sse(stream(1_100_000, 1_090_000))).toBe(stream(1_100_000, 1_090_000))
    expect(fix.mode('k')).toBeUndefined()
    // 第二个请求：认定，事件分两段到也都改
    const second = fix.request('k')
    const text = stream(1_100_000, 1_090_000)
    const cut = text.indexOf('event: message_delta')
    const out = second.sse(text.slice(0, cut)) + second.sse(text.slice(cut))
    const datas = out
      .split(/\r?\n/)
      .filter(l => l.startsWith('data: '))
      .map(l => JSON.parse(l.slice(6)))
    expect(datas[0].message.usage.input_tokens).toBe(10_000)
    expect(datas[1].delta.text).toBe('usage')
    expect(datas[2].usage).toMatchObject({ input_tokens: 10_000, cache_read_input_tokens: 1_090_000, output_tokens: 9 })
    expect(out).toContain(
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"usage"}}\r\n\r\n',
    )
  })

  it('不带 usage 的内容逐字原样；坏 JSON 不抛错', () => {
    const r = new CacheUsageFix().request('k')
    expect(r.sse('event: ping\ndata: {"type":"ping"}\n\n')).toBe('event: ping\ndata: {"type":"ping"}\n\n')
    expect(r.sse('data: {"usage": oops\n\n')).toBe('data: {"usage": oops\n\n')
    expect(r.json('{"usage":')).toBe('{"usage":')
  })
})
