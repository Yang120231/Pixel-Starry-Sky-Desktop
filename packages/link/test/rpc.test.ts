import { describe, expect, it } from 'vitest'
import { RpcCore, type RpcMessage } from '../src'

function pair() {
  const a: RpcCore = new RpcCore(
    m => queueMicrotask(() => b.receive(JSON.parse(JSON.stringify(m)))),
    (method, args) => ({ from: 'a', method, args }),
  )
  const b: RpcCore = new RpcCore(
    m => queueMicrotask(() => a.receive(m)),
    async (method, args) => {
      if (method === 'fail') throw new Error('EXPECTED')
      if (method === 'never') return new Promise(() => {})
      if (method === 'back') return b.call('nested', args)
      return args
    },
  )
  return { a, b }
}

describe('RpcCore', () => {
  it('answers calls, nested calls and errors', async () => {
    const { a } = pair()
    expect(await a.call('echo', [1, '中文'])).toEqual([1, '中文'])
    expect(await a.call('back', ['x'])).toEqual({ from: 'a', method: 'nested', args: ['x'] })
    await expect(a.call('fail')).rejects.toThrow('EXPECTED')
    await expect(a.call('never', [], 10)).rejects.toThrow('RPC_TIMEOUT: never')
  })

  it('delivers events and rejects pending calls on close', async () => {
    const { a, b } = pair()
    const events: unknown[] = []
    b.onEvent = (channel, data) => events.push([channel, data])
    a.event('engine:event', { kind: 'sessions' })
    await new Promise(r => setTimeout(r, 0))
    expect(events).toEqual([['engine:event', { kind: 'sessions' }]])
    const pending = a.call('never')
    a.close()
    await expect(pending).rejects.toThrow('LINK_CLOSED')
    await expect(a.call('echo')).rejects.toThrow('LINK_CLOSED')
  })

  it('closes on a malformed message and when output throws', async () => {
    let reason = ''
    const core = new RpcCore(() => {}, undefined, { closedMessage: 'GONE' })
    core.onClose = e => (reason = e.message)
    core.receive({ id: 'x' })
    expect(core.isClosed).toBe(true)
    expect(reason).toBe('Invalid RPC id')
    await expect(core.call('x')).rejects.toThrow('GONE')
    const sent: RpcMessage[] = []
    const full = new RpcCore(m => {
      sent.push(m)
      throw new Error('TOO_BIG')
    })
    await expect(full.call('x')).rejects.toThrow('TOO_BIG')
    full.event('e', 1)
    expect(full.isClosed).toBe(true)
    expect(sent).toHaveLength(2)
  })
})
