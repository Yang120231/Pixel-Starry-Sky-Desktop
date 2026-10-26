// 引擎检测的「在跑时再要求重来」（Rerun）：连续切号时第二次强制检测不能并入用旧环境的那次
import { describe, expect, it, vi } from 'vitest'
import type { EngineInfo } from '@pixelsky/protocol'
import { ClaudeAdapter, CodexAdapter } from '../src'
import { Rerun } from '../src/rerun'

function gated() {
  const gates: (() => void)[] = []
  let n = 0
  const r = new Rerun(
    () =>
      new Promise<number>(resolve => {
        const i = ++n
        gates.push(() => resolve(i))
      }),
  )
  return { r, gates, runs: () => n }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Rerun', () => {
  it('在跑时不要求重来：并入；要求重来：跑完再跑一次，期间多次要求只多跑一次', async () => {
    const { r, gates, runs } = gated()
    const a = r.run()
    const b = r.run()
    const c = r.run(true)
    const d = r.run(true)
    const e = r.run()
    expect(b).toBe(a)
    expect(d).toBe(c)
    expect(e).toBe(c)
    expect(r.pending()).toBe(c)
    gates[0]()
    expect(await a).toBe(1)
    await flush()
    expect(runs()).toBe(2)
    gates[1]()
    expect([await c, await d, await e]).toEqual([2, 2, 2])
    expect(r.pending()).toBeNull()
  })

  it('前一次失败也照样再跑；没有在跑的时候要求重来就直接跑', async () => {
    const r = new Rerun(async () => 'ok')
    expect(await r.run(true)).toBe('ok')
    let fail = true
    const s = new Rerun(() => (fail ? Promise.reject(new Error('x')) : Promise.resolve('ok')))
    const first = s.run()
    fail = false
    const again = s.run(true)
    await expect(first).rejects.toThrow('x')
    expect(await again).toBe('ok')
  })

  it('排着的那次开始前、上一次刚结束的空当里，不要求重来的调用不另起一次', async () => {
    const { r, gates, runs } = gated()
    void r.run()
    const queued = r.run(true)
    gates[0]()
    expect(r.run()).toBe(queued)
    await flush()
    expect(runs()).toBe(2)
    gates[1]()
    expect(await queued).toBe(2)
  })
})

describe('连续切号：A → B 的检测没完就切到 C', () => {
  // 假检测：开始时记下当前账号（真检测在开始时取环境），放行后按那个账号回结果
  function fake(adapter: object, engine: 'claude' | 'codex', current: () => string) {
    const gates: (() => void)[] = []
    vi.spyOn(adapter as { detect: () => unknown }, 'detect').mockImplementation(() => {
      const who = current()
      return new Promise(resolve =>
        gates.push(() => {
          const info = { id: engine, status: 'ready', account: { email: who } } as EngineInfo
          if (engine === 'codex') {
            ;(adapter as { cached: unknown }).cached = { info, launcher: null }
            resolve(info)
          } else resolve({ info, launcher: null, projectsDir: null })
        }),
      )
    })
    return gates
  }

  it.each(['claude', 'codex'] as const)('%s：第二次强制检测等前一次跑完再按 C 检测，缓存里是 C', async engine => {
    let account = 'b@example.com'
    const adapter =
      engine === 'claude' ? new ClaudeAdapter({ account: () => account }) : new CodexAdapter({ account: () => account })
    const gates = fake(adapter, engine, () => account)
    const toB = adapter.info(true)
    account = 'c@example.com'
    const toC = adapter.info(true)
    gates[0]()
    expect((await toB).account?.email).toBe('b@example.com')
    await flush()
    expect(gates).toHaveLength(2)
    gates[1]()
    expect((await toC).account?.email).toBe('c@example.com')
    expect((await adapter.info()).account?.email).toBe('c@example.com')
  })
})
