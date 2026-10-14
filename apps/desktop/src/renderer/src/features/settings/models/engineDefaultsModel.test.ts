import { describe, expect, it } from 'vitest'
import type { EngineModel } from '@pixelsky/protocol'
import { effortChoices, engineConfigurable, followedModel, keepEffort } from './engineDefaultsModel'

const model = (id: string, efforts: EngineModel['efforts'], extra: Partial<EngineModel> = {}): EngineModel => ({
  id,
  label: id,
  efforts,
  defaultEffort: efforts[0] ?? null,
  inputModalities: [],
  isDefault: false,
  ...extra,
})

describe('engineDefaultsModel', () => {
  it('装好了（含没登录）才能设', () => {
    expect(engineConfigurable('ready')).toBe(true)
    expect(engineConfigurable('unauthenticated')).toBe(true)
    for (const s of ['missing', 'outdated', 'error', 'unsupported', undefined])
      expect(engineConfigurable(s)).toBe(false)
  })

  it('跟随引擎设置时：currentModel，其次目录里的默认模型', () => {
    expect(followedModel({ outputStyles: [], currentOutputStyle: null, currentModel: 'gpt-5-codex' })).toBe(
      'gpt-5-codex',
    )
    expect(
      followedModel({
        outputStyles: [],
        currentOutputStyle: null,
        models: [model('a', []), model('b', [], { isDefault: true })],
      }),
    ).toBe('b')
    expect(followedModel(null)).toBeNull()
  })

  it('强度档位按所选模型，没选时按引擎当前模型，都没有用引擎能力', () => {
    const models = [
      model('gpt-5', ['low', 'medium', 'high']),
      model('mini', ['low']),
      model('opus', [], { resolved: 'claude-opus' }),
    ]
    const caps = ['low', 'medium', 'high', 'xhigh'] as const
    expect(effortChoices('mini', models, 'gpt-5', caps)).toEqual(['low'])
    expect(effortChoices(null, models, 'gpt-5', caps)).toEqual(['low', 'medium', 'high'])
    expect(effortChoices('claude-opus', models, null, caps)).toEqual([...caps])
    expect(effortChoices('unknown', models, null, caps)).toEqual([...caps])
    expect(effortChoices(null, undefined, null, caps)).toEqual([...caps])
  })

  it('默认强度不在新档位里时回到跟随', () => {
    expect(keepEffort('high', ['low', 'high'])).toBe('high')
    expect(keepEffort('xhigh', ['low', 'high'])).toBeNull()
    expect(keepEffort(null, ['low'])).toBeNull()
  })
})
