// 切换机器排队：切换中再切不会假装已经切好（审查报告 2026-10-14 第 5 条：终端选择因此陷入死循环）
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data', () => ({ isDemo: false }))
vi.mock('@/data/demo', () => ({ demo: () => ({}) }))
vi.mock('@/features/engine/store', () => ({
  getEngineState: () => ({ sessions: [] }),
  setCurrentProject: vi.fn(),
  refreshMachineEngine: () => Promise.resolve(),
  invalidateRemoteSnapshots: vi.fn(),
}))
vi.mock('@/features/panes/store', () => ({ paneActions: { switchMachine: vi.fn(), prune: vi.fn() } }))
vi.mock('@/features/terminal/store', () => ({ refreshTerminals: () => Promise.resolve() }))
vi.mock('@/features/panes/tree', () => ({ isNewTab: () => false }))

// 主进程：select 要等 release() 才返回，模拟 SSH / WSL 连接的耗时
let current = 'local'
const selected: string[] = []
let pending: (() => void)[] = []
const release = async (): Promise<void> => {
  const all = pending
  pending = []
  all.forEach(done => done())
  await new Promise(r => setTimeout(r, 0))
}
let fail: string | null = null
vi.stubGlobal('window', {
  pixelsky: {
    machines: {
      select: (id: string) =>
        new Promise<void>((resolve, reject) => {
          selected.push(id)
          pending.push(() => {
            if (id === fail) reject(new Error('连不上'))
            else {
              current = id
              resolve()
            }
          })
        }),
      state: () =>
        Promise.resolve({
          currentId: current,
          machines: ['local', 'ssh-a', 'ssh-b'].map(id => ({
            id,
            kind: id === 'local' ? 'local' : 'ssh',
            status: 'connected',
          })),
        }),
    },
  },
})

const { selectMachine, getMachines } = await import('./store')

/** 一直放行主进程，直到 promise 完成 */
async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  let result: PromiseSettledResult<T> | null = null
  void promise.then(
    value => (result = { status: 'fulfilled', value }),
    reason => (result = { status: 'rejected', reason }),
  )
  for (let i = 0; i < 50 && !result; i++) await release()
  return result!
}

beforeEach(async () => {
  fail = null
  selected.length = 0
  await settle(selectMachine('local'))
  selected.length = 0
})

describe('切换机器', () => {
  it('切换中再切到另一台：排队执行，完成时当前机器就是要切的那台', async () => {
    const first = selectMachine('ssh-a')
    const second = selectMachine('ssh-b')
    expect((await settle(first)).status).toBe('fulfilled')
    expect((await settle(second)).status).toBe('fulfilled')
    expect(getMachines().currentId).toBe('ssh-b')
    expect(selected).toEqual(['ssh-a', 'ssh-b'])
  })
  it('切换中再切同一台：等前一次完成，不重复切', async () => {
    const first = selectMachine('ssh-a')
    const again = selectMachine('ssh-a')
    await settle(first)
    expect((await settle(again)).status).toBe('fulfilled')
    expect(getMachines().currentId).toBe('ssh-a')
    expect(selected).toEqual(['ssh-a'])
  })
  it('前一次失败不影响排在后面的', async () => {
    fail = 'ssh-a'
    const first = selectMachine('ssh-a')
    const second = selectMachine('ssh-b')
    expect((await settle(first)).status).toBe('rejected')
    expect((await settle(second)).status).toBe('fulfilled')
    expect(getMachines().currentId).toBe('ssh-b')
  })
})
