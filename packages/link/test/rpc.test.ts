import { describe, expect, it, vi } from 'vitest'
import { RpcCore, type RpcMessage } from '../src'
import { RPC_SIZE_LIMIT } from '../src/rpc'

// 包里不带 DOM / Node 类型（globals.d.ts），这里只用到 console.error
declare const console: { error(...args: unknown[]): void }

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

describe('RpcCore size limit', () => {
  /** 传输层的上限：序列化后超过 100 字符就抛 RPC_SIZE_LIMIT（machines/rpc.ts 按 48 MB） */
  function limited() {
    const send = (to: () => RpcCore) => (m: RpcMessage) => {
      if (JSON.stringify(m).length > 100) throw new Error(RPC_SIZE_LIMIT)
      queueMicrotask(() => to().receive(m))
    }
    const a: RpcCore = new RpcCore(send(() => b))
    const b: RpcCore = new RpcCore(
      send(() => a),
      (method, args) => (method === 'big' ? 'x'.repeat(200) : args),
    )
    return { a, b }
  }

  it('answers an oversized reply with RPC_SIZE_LIMIT and keeps the link open', async () => {
    const { a, b } = limited()
    await expect(a.call('big')).rejects.toThrow(RPC_SIZE_LIMIT)
    expect(a.isClosed || b.isClosed).toBe(false)
    expect(await a.call('echo', [1])).toEqual([1])
  })

  it('drops and logs an oversized event, other write errors still close', async () => {
    const { a, b } = limited()
    const events: unknown[] = []
    b.onEvent = (channel, data) => events.push([channel, data])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    a.event('big', 'x'.repeat(200))
    a.event('small', 1)
    await new Promise(r => setTimeout(r, 0))
    expect(events).toEqual([['small', 1]])
    expect(error).toHaveBeenCalledWith('[rpc] event dropped: RPC_SIZE_LIMIT', 'big')
    error.mockRestore()
    expect(a.isClosed).toBe(false)
    expect(await a.call('echo', [2])).toEqual([2])
    // 回复写不出去且不是太大（连接断了）：照旧关闭
    let closed = ''
    const broken = new RpcCore(
      () => {
        throw new Error('BROKEN')
      },
      () => 1,
    )
    broken.onClose = e => (closed = e.message)
    broken.receive({ id: 1, method: 'x', args: [] })
    await new Promise(r => setTimeout(r, 0))
    expect(closed).toBe('BROKEN')
  })
})
