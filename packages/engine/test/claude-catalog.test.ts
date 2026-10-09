// Claude 动态模型目录：初始化握手里的 models 映射成 catalog.models（只握手，不发消息）
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../src'
import { claudeModels } from '../src/claude'

const FAKE = fileURLToPath(new URL('./fakes/fake-claude.mjs', import.meta.url))

describe('Claude 动态模型目录', () => {
  it('catalog() 把握手里的 models 映射成目录模型，跳过 default', async () => {
    const adapter = new ClaudeAdapter({
      launcher: { command: process.execPath, args: [FAKE] },
      env: { ...process.env },
    })
    const catalog = await adapter.catalog()
    expect(catalog.models).toEqual([
      {
        id: 'opus',
        label: 'Opus 5.5',
        description: 'For complex work and everyday tasks',
        resolved: 'claude-opus-5-5',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: null,
        inputModalities: ['text', 'image'],
        isDefault: false,
      },
      {
        id: 'haiku',
        label: 'Haiku 5.5',
        description: 'Fastest model for simple tasks',
        resolved: 'claude-haiku-5-5',
        efforts: [],
        defaultEffort: null,
        inputModalities: ['text', 'image'],
        isDefault: false,
      },
    ])
    expect(catalog.outputStyles).toEqual(['default', 'Explanatory', 'Learning'])
  })

  it('claudeModels：缺字段返回空，跳过没有 value 的项，displayName 缺失时用 value 当名字', () => {
    expect(claudeModels(undefined)).toEqual([])
    expect(claudeModels('x')).toEqual([])
    const models = claudeModels([
      { displayName: '没有 value' },
      null,
      { value: 'sonnet', supportedEffortLevels: ['low', 'bogus', 'ultra'] },
    ])
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'sonnet', label: 'sonnet', efforts: ['low', 'ultra'], resolved: undefined })
  })
})
