import { describe, expect, it } from 'vitest'
import { vendorFallbackModel, vendorModels, vendorSmallModel } from './vendor-models'

describe('vendor-models', () => {
  it('只在线路没有 Claude 模型时给出可用模型', () => {
    expect(vendorModels(['deepseek-v4.1-flash'])).toEqual(['deepseek-v4.1-flash'])
    expect(vendorModels(['claude-sonnet-4-5', 'deepseek-chat'])).toEqual([])
    expect(vendorModels(['gpt-5', 'gpt-5-mini'])).toEqual([])
    expect(vendorModels([])).toEqual([])
  })

  it('小模型优先选轻量版', () => {
    expect(vendorSmallModel(['glm-5', 'glm-5-air'], 'glm-5')).toBe('glm-5-air')
    expect(vendorSmallModel(['kimi-k3'], 'kimi-k3')).toBe('kimi-k3')
    expect(vendorSmallModel(['deepseek-reasoner'], 'deepseek-reasoner')).toBe('deepseek-reasoner')
  })

  it('网关把线路里没有的模型换成会话模型或小模型', () => {
    const models = ['deepseek-v4.1-pro', 'deepseek-v4.1-flash']
    expect(vendorFallbackModel(models, 'claude-sonnet-4-5', 'deepseek-v4.1-pro')).toBe('deepseek-v4.1-pro')
    expect(vendorFallbackModel(models, 'claude-haiku-4-5', 'deepseek-v4.1-pro')).toBe('deepseek-v4.1-flash')
    expect(vendorFallbackModel(models, 'claude-opus-4-1', 'claude-opus-4-1')).toBe('deepseek-v4.1-pro')
    expect(vendorFallbackModel(models, null, null)).toBe('deepseek-v4.1-pro')
    expect(vendorFallbackModel(models, 'deepseek-v4.1-flash', 'deepseek-v4.1-pro')).toBeNull()
    expect(vendorFallbackModel(['claude-sonnet-4-5'], 'claude-haiku-4-5', null)).toBeNull()
    expect(vendorFallbackModel([], 'claude-haiku-4-5', null)).toBeNull()
  })
})
