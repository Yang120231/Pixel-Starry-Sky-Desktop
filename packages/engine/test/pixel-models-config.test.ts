// pixelModelsConfig：宿主标的猜的字段（模型的 inferred）并进 PIXELSKY_PIXEL_INFERRED、不写进模型定义；
// Chat 协议默认只给文字（标成猜的，命令行按 Pi 内置表改）
import { describe, expect, it } from 'vitest'
import { pixelModelsConfig } from '../src/pixel/session'

type Models = { models: Array<Record<string, unknown>> }

describe('pixelModelsConfig：宿主标的 inferred、Chat 的默认值', () => {
  it('模型里的 inferred 取出来并进猜的字段，不留在模型定义里', () => {
    const config = pixelModelsConfig(
      {
        PIXELSKY_PIXEL_BASE_URL: 'http://x/v1',
        PIXELSKY_PIXEL_API: 'openai-completions',
        PIXELSKY_PIXEL_MODELS: JSON.stringify([
          { id: 'kimi-k3', compat: { supportsStore: false }, inferred: ['compat'] },
          { id: 'glm-5.2', inferred: 'bad' },
        ]),
      },
      'pixelsky/kimi-k3',
    )
    const models = (config?.providers.pixelsky as Models).models
    expect(models[0]).toEqual({
      id: 'kimi-k3',
      compat: { supportsStore: false },
      reasoning: false,
      input: ['text'],
    })
    expect(models[1]).not.toHaveProperty('inferred')
    expect(config?.inferred).toEqual({
      pixelsky: { 'kimi-k3': ['reasoning', 'input', 'compat'], 'glm-5.2': ['reasoning', 'input'] },
    })
  })

  it('别的协议照旧：推理开、收图片', () => {
    const config = pixelModelsConfig(
      { PIXELSKY_PIXEL_BASE_URL: 'http://x', PIXELSKY_PIXEL_MODELS: '["claude-opus-4-7"]' },
      null,
    )
    expect((config?.providers.pixelsky as Models).models[0]).toEqual({
      id: 'claude-opus-4-7',
      reasoning: true,
      input: ['text', 'image'],
    })
  })
})
