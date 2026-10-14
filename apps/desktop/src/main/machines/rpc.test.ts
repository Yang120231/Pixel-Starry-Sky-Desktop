import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
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
  it('whenClosed 在连接关闭时通知', () => {
    const peer = new RpcPeer(new PassThrough(), new PassThrough())
    let closed = 0
    peer.whenClosed(() => closed++)
    peer.close()
    expect(closed).toBe(1)
  })
})
