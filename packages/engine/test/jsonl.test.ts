import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { LINE_MAX, LineSplitter, STRING_KEEP, droppedRef, readJsonLines } from '../src/jsonl'

describe('readJsonLines', () => {
  it('一行被切成很多块、多行挤在一块、结尾没有换行都能读对', async () => {
    const stream = new PassThrough()
    const got: unknown[] = []
    const bad: string[] = []
    readJsonLines(
      stream,
      m => got.push(m),
      l => bad.push(l),
    )
    const big = JSON.stringify({ text: 'x'.repeat(5000) })
    for (let i = 0; i < big.length; i += 700) stream.write(big.slice(i, i + 700))
    stream.write('\n{"a":1}\nnot json\n{"b":')
    stream.write('2}\n{"c":3}')
    const ended = new Promise(resolve => stream.on('end', resolve))
    stream.end()
    await ended
    expect(got).toEqual([{ text: 'x'.repeat(5000) }, { a: 1 }, { b: 2 }, { c: 3 }])
    expect(bad).toEqual(['not json'])
  })
})

describe('LineSplitter', () => {
  it('大行跨很多块、同一块里还挤着下一行的开头', () => {
    const s = new LineSplitter()
    const big = 'y'.repeat(100_000)
    const out: string[] = []
    for (let i = 0; i < big.length; i += 700) out.push(...s.push(big.slice(i, i + 700)))
    expect(out).toEqual([])
    expect(s.push('tail\nnext1\nne')).toEqual([big + 'tail', 'next1'])
    expect(s.push('xt2')).toEqual([])
    expect(s.end()).toBe('next2')
  })
  it('行尾 CR 落在上一块末尾时拼成整行后仍在行尾', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":1}\r')).toEqual([])
    expect(s.push('\n')).toEqual(['{"a":1}\r'])
  })
})

describe('LineSplitter 截短超长字符串（docs/engine-output-limits.md）', () => {
  const feed = (s: LineSplitter, text: string, size = 65536): string[] => {
    const out: string[] = []
    for (let i = 0; i < text.length; i += size) out.push(...s.push(text.slice(i, i + size)))
    return out
  }

  it('超过 STRING_KEEP 的字符串只留开头，后面写原长；其它字段原样，行还是合法 JSON', () => {
    const s = new LineSplitter()
    const long = 'a'.repeat(STRING_KEEP + 500)
    const [line] = feed(s, JSON.stringify({ id: 7, result: { out: long, name: '短' } }) + '\n')
    const value = JSON.parse(line) as { id: number; result: { out: string; name: string } }
    expect(value.id).toBe(7)
    expect(value.result.name).toBe('短')
    expect(value.result.out.startsWith('a'.repeat(STRING_KEEP))).toBe(true)
    expect(value.result.out.endsWith(`…[已截断，原长 ${STRING_KEEP + 500} 字符]`)).toBe(true)
  })

  it('data: 开头的超长字符串（图片）整个换成占位', () => {
    const s = new LineSplitter()
    const url = 'data:image/png;base64,' + 'Q'.repeat(STRING_KEEP)
    const [line] = feed(s, JSON.stringify({ items: [{ url }, { url: 'data:x' }] }) + '\n', 1000)
    expect(JSON.parse(line)).toEqual({ items: [{ url: `[图片已省略，原长 ${url.length} 字符]` }, { url: 'data:x' }] })
  })

  it('转义（反斜杠、引号、\\u0001 这类）不会被截成半个，也不会被当成字符串结尾', () => {
    const s = new LineSplitter()
    // JSON 里依次是 \\ \" \u0001 x：截断点落在哪个转义中间都要能解析
    const long = '\\"\u0001x'.repeat(STRING_KEEP / 8)
    for (let pad = 0; pad < 11; pad++) {
      const [line, next] = feed(s, JSON.stringify({ t: 'p'.repeat(pad) + long }) + '\n{"b":1}\n', 777)
      expect((JSON.parse(line) as { t: string }).t).toContain('…[已截断')
      expect(next).toBe('{"b":1}')
    }
  })

  it('截短后仍超过 LINE_MAX 的行整行丢掉，交给 onDrop，后面的行照常', () => {
    const dropped: { length: number; head: string }[] = []
    const s = new LineSplitter(d => dropped.push(d))
    const piece = 'b'.repeat(STRING_KEEP)
    const count = Math.ceil(LINE_MAX / STRING_KEEP) + 1
    const big = `{"id":3,"result":[${Array.from({ length: count }, () => JSON.stringify(piece)).join(',')}]}`
    expect(feed(s, big + '\n{"ok":true}\n', 4 * 1024 * 1024)).toEqual(['{"ok":true}'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0].length).toBe(big.length)
    expect(droppedRef(dropped[0].head, 'method')).toEqual({ id: 3, kind: null })
  })

  it('droppedRef 认出 Codex 的 method、像素星空的 type 和字符串 id', () => {
    expect(droppedRef('{"method":"thread/started","params":{"id":"x"', 'method')).toEqual({
      id: 'x',
      kind: 'thread/started',
    })
    expect(droppedRef('{"id":"req-1","type":"response","command":"get_messages"', 'type')).toEqual({
      id: 'req-1',
      kind: 'response',
    })
  })
})
