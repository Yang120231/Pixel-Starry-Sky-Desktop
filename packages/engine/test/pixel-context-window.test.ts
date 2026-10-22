import { describe, expect, it } from 'vitest'
import { pixelAutoWindow, pixelWindow } from '../src/pixel/context-window'
import { pixelModelsConfig } from '../src/pixel/session'

const platform = { platform: { groupId: '1', account: 'a@b.c' }, provider: null }
const custom = { platform: null, provider: { id: 'ds', name: 'DeepSeek' } }

describe('像素星空经网关时的上下文窗口', () => {
  it('按系列自动定：Claude、DeepSeek 1M，Codex（GPT）、Grok 500K，认不出的交给 Pi', () => {
    expect(pixelAutoWindow('claude-opus-4-7')).toBe(1_000_000)
    expect(pixelAutoWindow('claude-some-new-model')).toBe(1_000_000)
    expect(pixelAutoWindow('deepseek-v4.1-flash')).toBe(1_000_000)
    expect(pixelAutoWindow('gpt-5.9-codex')).toBe(500_000)
    expect(pixelAutoWindow('grok-4.2')).toBe(500_000)
    expect(pixelAutoWindow('kimi-k2')).toBeNull()
  })

  it('官方表里更小的老模型取官方值', () => {
    expect(pixelAutoWindow('claude-haiku-4-5')).toBe(200_000)
    expect(pixelAutoWindow('claude-sonnet-4-5')).toBe(200_000)
    expect(pixelAutoWindow('gpt-5.3-codex')).toBe(272_000)
  })

  it('云端线路：设置里填的优先（不算猜的），没填按系列猜', () => {
    const windows = { platform: { 'gpt-5.5': 300_000 }, self: { 'gpt-5.5': 100_000 } }
    expect(pixelWindow(platform, 'gpt-5.5', windows)).toEqual({ window: 300_000, auto: false })
    expect(pixelWindow(platform, 'grok-4', windows)).toEqual({ window: 500_000, auto: true })
    expect(pixelWindow(platform, 'kimi-k2', windows)).toBeNull()
  })

  it('自定义 API 接口里没写窗口时也按系列猜；本机不管', () => {
    const windows = { platform: { 'deepseek-v4.1-flash': 300_000 }, self: {} }
    // 云端线路的设置不套到自定义 API 上
    expect(pixelWindow(custom, 'deepseek-v4.1-flash', windows)).toEqual({ window: 1_000_000, auto: true })
    expect(pixelWindow({ platform: null, provider: null }, 'gpt-5.5', windows)).toBeNull()
  })

  it('pixelModelsConfig：只给没写窗口的模型补上，并标出哪些字段是猜的', () => {
    const config = pixelModelsConfig(
      {
        PIXELSKY_PIXEL_BASE_URL: 'http://x',
        PIXELSKY_PIXEL_MODELS: JSON.stringify([{ id: 'own', contextWindow: 64_000, input: ['text'] }]),
      },
      'pixelsky/claude-opus-4-7',
      id => pixelWindow(platform, id, { platform: {}, self: {} }),
    )
    const models = (config?.providers.pixelsky as { models: Array<{ id: string; contextWindow?: number }> }).models
    expect(models.map(m => [m.id, m.contextWindow])).toEqual([
      ['own', 64_000],
      ['claude-opus-4-7', 1_000_000],
    ])
    expect(config?.inferred).toEqual({
      pixelsky: { own: ['reasoning'], 'claude-opus-4-7': ['reasoning', 'input', 'contextWindow'] },
    })
  })

  it('pixelModelsConfig：Chat 默认只收文字，名字带 vision / vl 的默认能看图；桌面端写明的 input 不动', () => {
    const config = pixelModelsConfig(
      {
        PIXELSKY_PIXEL_BASE_URL: 'http://x',
        PIXELSKY_PIXEL_API: 'openai-completions',
        PIXELSKY_PIXEL_MODELS: JSON.stringify([
          { id: 'grok-4' },
          { id: 'qwen3-vl-plus' },
          { id: 'grok-code', input: ['text', 'image'] },
        ]),
      },
      null,
    )
    const models = (config?.providers.pixelsky as { models: Array<{ id: string; input: string[] }> }).models
    expect(models.map(m => [m.id, m.input])).toEqual([
      ['grok-4', ['text']],
      ['qwen3-vl-plus', ['text', 'image']],
      ['grok-code', ['text', 'image']],
    ])
    expect(config?.inferred?.pixelsky?.['grok-code']).not.toContain('input')
  })
})
