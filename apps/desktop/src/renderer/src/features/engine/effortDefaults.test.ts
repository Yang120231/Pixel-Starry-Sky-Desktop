// 推理强度那几项的默认值（GitHub #6）
import { describe, expect, it } from 'vitest'
import { EFFORT_PANEL_FACTORY, type EngineConfig, type EngineDefaults } from '@pixelsky/protocol'
import { effortDefaultsFor, effortDiff } from './effortDefaults'

const local = (d: Partial<EngineConfig['claude']['defaults']>) =>
  ({
    defaults: {
      model: null,
      effort: 'high',
      permissionMode: 'edits',
      ultracode: false,
      fast: false,
      thinkingSummaries: true,
      ...d,
    },
  }) as EngineConfig['claude']

const config = { claude: local({ effort: 'max', fast: true }), codex: local({ effort: 'low' }) } as EngineConfig
const all = { effort: true, ultracode: true, fast: true, thinkingSummaries: true }

describe('每个引擎自己的默认值', () => {
  it('切换引擎时用切过去那个引擎的，不是写死的出厂值', () => {
    expect(effortDefaultsFor(config, null, 'claude')).toEqual({
      effort: 'max',
      ultracode: false,
      fast: true,
      thinkingSummaries: true,
    })
    expect(effortDefaultsFor(config, null, 'codex').effort).toBe('low')
  })

  it('引擎配置还没读到：默认引擎用宿主报的默认值，其余用出厂值', () => {
    const defaults = {
      engine: 'codex',
      effort: 'medium',
      ultracode: true,
      fast: false,
      thinkingSummaries: false,
    } as EngineDefaults
    expect(effortDefaultsFor(null, defaults, 'codex')).toEqual({
      effort: 'medium',
      ultracode: true,
      fast: false,
      thinkingSummaries: false,
    })
    expect(effortDefaultsFor(null, defaults, 'claude')).toEqual(EFFORT_PANEL_FACTORY)
  })
})

describe('当前值和默认值的差别', () => {
  it('列出不一样的几项', () => {
    const d = EFFORT_PANEL_FACTORY
    expect(effortDiff(d, d, all)).toEqual([])
    expect(effortDiff({ ...d, effort: 'low', fast: true }, d, all)).toEqual(['effort', 'fast'])
  })

  it('引擎不支持的开关、没有强度档位的模型不算', () => {
    const d = EFFORT_PANEL_FACTORY
    expect(
      effortDiff({ ...d, effort: 'low', ultracode: true }, d, { ...all, effort: false, ultracode: false }),
    ).toEqual([])
  })
})
