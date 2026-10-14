import { describe, expect, it } from 'vitest'
import { platformModelApi, platformModelsForEngine, platformModelSupportsEngine } from './platform-models'

describe('平台模型和执行协议', () => {
  it.each([
    'gpt-6-astra',
    'gpt-6.1-sol',
    'openai/gpt-6.1-sol',
    'openai.gpt-6-astra',
    ' GPT-6.1-SOL ',
    'o3',
    'o4-mini',
    'chatgpt-4o-latest',
  ])('%s 使用 Responses，不交给 Claude Code', model => {
    expect(platformModelApi(model)).toBe('responses')
    expect(platformModelSupportsEngine(model, 'claude')).toBe(false)
    expect(platformModelSupportsEngine(model, 'codex')).toBe(true)
    expect(platformModelSupportsEngine(model, 'pixel')).toBe(true)
  })
  it.each(['claude-opus-5-5', 'anthropic/claude-sonnet-5-5', 'claude-opus-5-5[1m]'])(
    '%s 使用 Messages，不交给 Codex',
    model => {
      expect(platformModelApi(model)).toBe('messages')
      expect(platformModelSupportsEngine(model, 'claude')).toBe(true)
      expect(platformModelSupportsEngine(model, 'codex')).toBe(false)
      expect(platformModelSupportsEngine(model, 'pixel')).toBe(true)
    },
  )
  it('未知模型保留线路的协议判断', () => {
    expect(platformModelApi('deepseek-chat')).toBeNull()
    expect(platformModelApi(null)).toBeNull()
    expect(platformModelSupportsEngine('relay-model', 'claude')).toBe(true)
    expect(platformModelSupportsEngine('relay-model', 'codex')).toBe(true)
  })
  it('混合线路按引擎过滤，默认模型不能再解析到不兼容模型；全量目录不变', () => {
    const groups = [{ id: 'both', models: ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5-5', 'relay-model'] }]
    expect(platformModelsForEngine(groups, 'claude')[0].models).toEqual(['claude-opus-5-5', 'relay-model'])
    expect(platformModelsForEngine(groups, 'codex')[0].models).toEqual(['gpt-6-astra', 'gpt-6.1-sol', 'relay-model'])
    expect(platformModelsForEngine(groups, 'pixel')).toEqual(groups)
    expect(groups[0].models).toHaveLength(4)
  })
})
