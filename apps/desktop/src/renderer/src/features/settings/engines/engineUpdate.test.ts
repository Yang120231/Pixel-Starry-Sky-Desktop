import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/engine', () => ({ bridge: null }))
const { canUpdate, hasNewer, outcomeTitle, updateEngine, useEngineUpdate } = await import('./engineUpdate')
import type { EngineLite } from '@/data/types'

const engine = (patch: Partial<EngineLite> = {}): EngineLite =>
  ({
    id: 'claude',
    name: 'Claude Code',
    status: 'ready',
    version: '2.1.296',
    message: null,
    path: 'claude.exe',
    caps: { selfUpdate: true },
    ...patch,
  }) as EngineLite

describe('引擎一键更新（界面）', () => {
  it('只有查到更新的版本、引擎支持且装着时才提示', () => {
    expect(hasNewer(engine({ latestVersion: '2.1.300' }))).toBe(true)
    expect(hasNewer(engine({ latestVersion: '2.1.296' }))).toBe(false)
    expect(hasNewer(engine())).toBe(false)
    expect(hasNewer(engine({ latestVersion: '2.1.300', status: 'missing' }))).toBe(false)
    expect(hasNewer(engine({ latestVersion: '2.1.300', caps: { selfUpdate: false } as EngineLite['caps'] }))).toBe(
      false,
    )
    // 版本太低（outdated）也能更新
    expect(canUpdate(engine({ status: 'outdated' }))).toBe(true)
  })

  it('演示模式点更新只给出提示，不调用本机', async () => {
    await updateEngine(engine())
    expect(useEngineUpdate).toBeTypeOf('function')
    const title = outcomeTitle({ error: '演示模式不更新本机程序' })
    expect(title).toBe('演示模式不更新本机程序')
  })

  it('结果的一句话：更新到新版本 / 没完成', () => {
    expect(outcomeTitle({ ok: true, output: '', version: '2.1.300', before: '2.1.296' })).toContain('2.1.300')
    expect(outcomeTitle({ ok: false, output: 'EBUSY', version: '2.1.296', before: '2.1.296' })).not.toContain('2.1.300')
  })
})
