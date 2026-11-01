import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcPeer } from './rpc'
const peers: RpcPeer[] = []
afterEach(() => {
  peers.forEach(p => p.close())
  peers.length = 0
})
function pair() {
  const forward = new PassThrough(),
    backward = new PassThrough()
  const a = new RpcPeer(backward, forward, async (_method, args) => ({ forwarded: args[0] }))
  const b = new RpcPeer(forward, backward, async (method, args) => {
    if (method === 'error') throw new Error('EXPECTED_REMOTE_ERROR')
    if (method === 'timeout') return new Promise(() => {})
    if (method === 'callback') return a === b ? null : b.call('desktop', args)
    if (method === 'slow') await new Promise(r => setTimeout(r, 20))
    return args
  })
  peers.push(a, b)
  return { a, b, forward }
}
describe('SSH JSONL RPC', () => {
  it('matches replies out of order and supports nested desktop callbacks', async () => {
    const { a } = pair()
    const slow = a.call('slow', ['中文'])
    expect(await a.call('fast', ['second'])).toEqual(['second'])
    expect(await slow).toEqual(['中文'])
    expect(await a.call('callback', ['roundtrip'])).toEqual({ forwarded: 'roundtrip' })
  })
  it('reports remote errors, times out and rejects outstanding calls on disconnect', async () => {
    const { a } = pair()
    await expect(a.call('error')).rejects.toThrow('EXPECTED_REMOTE_ERROR')
    await expect(a.call('timeout', [], 10)).rejects.toThrow('RPC_TIMEOUT')
    const pending = a.call('timeout')
    a.close()
    await expect(pending).rejects.toThrow('SSH_CONNECTION_CLOSED')
    await expect(a.call('fast')).rejects.toThrow('SSH_CONNECTION_CLOSED')
  })
  it('decodes split UTF-8 messages and event frames', async () => {
    const input = new PassThrough(),
      output = new PassThrough(),
      values: unknown[] = []
    const peer = new RpcPeer(input, output)
    peers.push(peer)
    peer.onEvent = (_name, value) => values.push(value)
    const data = Buffer.from(JSON.stringify({ event: 'test', data: '中文路径' }) + '\n')
    for (const byte of data) input.write(Buffer.from([byte]))
    expect(values).toEqual(['中文路径'])
  })
  it('第一条消息之前远端 shell 打印的横幅跳过；之后的坏行照样断开', () => {
    const input = new PassThrough(),
      output = new PassThrough(),
      values: unknown[] = []
    const peer = new RpcPeer(input, output)
    peers.push(peer)
    let closed = false
    peer.whenClosed(() => (closed = true))
    peer.onEvent = (_name, value) => values.push(value)
    input.write('Welcome to Ubuntu\n' + JSON.stringify({ event: 'test', data: 1 }) + '\n')
    expect(values).toEqual([1])
    expect(closed).toBe(false)
    input.write('garbage\n')
    expect(closed).toBe(true)
  })
  it('handle 按频道接收事件，未注册的频道仍给 onEvent', () => {
    const input = new PassThrough(),
      peer = new RpcPeer(input, new PassThrough()),
      handled: unknown[] = [],
      fallback: string[] = []
    peers.push(peer)
    peer.onEvent = name => fallback.push(name)
    peer.handle('tunnel:data', data => handled.push(data))
    input.write(JSON.stringify({ event: 'tunnel:data', data: 1 }) + '\n')
    input.write(JSON.stringify({ event: 'engine:event', data: 2 }) + '\n')
    expect(handled).toEqual([1])
    expect(fallback).toEqual(['engine:event'])
  })
  it('回复太大：调用方收到 RPC_SIZE_LIMIT，连接照常；太大的事件丢掉', async () => {
    const big = 'x'.repeat(49 * 1024 * 1024)
    const forward = new PassThrough(),
      backward = new PassThrough()
    const a = new RpcPeer(backward, forward)
    // 序列化本身失败（RangeError，几百 MB 的会话超过 V8 字符串上限时也是）同样只算这一条太大
    let deep: unknown = []
    for (let i = 0; i < 1_000_000; i++) deep = [deep]
    const b = new RpcPeer(forward, backward, async (method, args) =>
      method === 'big' ? big : method === 'deep' ? deep : args,
    )
    peers.push(a, b)
    const events: string[] = []
    a.onEvent = name => events.push(name)
    await expect(a.call('big')).rejects.toThrow('RPC_SIZE_LIMIT')
    await expect(a.call('deep')).rejects.toThrow('RPC_SIZE_LIMIT')
    expect(await a.call('echo', [1])).toEqual([1])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.event('big', big)
    b.event('small', 1)
    await new Promise(r => setImmediate(r))
    error.mockRestore()
    expect(events).toEqual(['small'])
    expect(await a.call('echo', [2])).toEqual([2])
  })
  it('很长的一行分成很多块到达：只拼一次（线性），超过上限照旧断开', async () => {
    const input = new PassThrough(),
      values: unknown[] = []
    const peer = new RpcPeer(input, new PassThrough())
    peers.push(peer)
    let reason = ''
    peer.onClose = e => (reason = e.message)
    peer.onEvent = (_name, value) => values.push((value as string).length)
    const line = JSON.stringify({ event: 'big', data: 'a'.repeat(60 * 1024 * 1024) }) + '\n'
    const started = Date.now()
    for (let i = 0; i < line.length; i += 64 * 1024) input.write(line.slice(i, i + 64 * 1024))
    await new Promise(r => setImmediate(r))
    // 以前每块都重拼整个缓冲：60 MB 要好几秒
    expect(Date.now() - started).toBeLessThan(1500)
    expect(values).toEqual([60 * 1024 * 1024])
    const chunk = 'b'.repeat(1024 * 1024)
    for (let i = 0; i <= 64 && !reason; i++) input.write(chunk)
    await new Promise(r => setImmediate(r))
    expect(reason).toBe('RPC_SIZE_LIMIT')
  }, 30_000)
  it('whenClosed 在连接关闭时通知', () => {
    const peer = new RpcPeer(new PassThrough(), new PassThrough())
    let closed = 0
    peer.whenClosed(() => closed++)
    peer.close()
    expect(closed).toBe(1)
  })
})
