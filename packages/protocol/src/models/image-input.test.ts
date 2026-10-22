import { describe, expect, it } from 'vitest'
import { autoImageInput, looksVisual, piBuiltinImage } from './image-input'

describe('模型能不能看图', () => {
  it('Pi 内置表：原名、日期后缀、同系列加后缀的名字', () => {
    expect(piBuiltinImage('grok-4.7')).toBe(true)
    expect(piBuiltinImage('grok-4.7-fast-reasoning')).toBe(true)
    expect(piBuiltinImage('claude-haiku-4-5-20251001')).toBe(true)
    expect(piBuiltinImage('grok-4')).toBeNull()
    expect(piBuiltinImage('xai/grok-4.7')).toBeNull()
  })

  it('名字一看就能看图的', () => {
    for (const id of ['grok-2-vision-1212', 'qwen3-vl-plus', 'qwen2.5-vl-72b', 'glm-4.5v', 'Qwen/Qwen3-VL-235B'])
      expect(looksVisual(id), id).toBe(true)
    for (const id of ['grok-4', 'deepseek-v4', 'glm-4.7', 'kimi-k3', 'gpt-5.5', 'devstral-latest', 'evolve-1'])
      expect(looksVisual(id), id).toBe(false)
  })

  it('自动：内置表 → 去前缀 → 名字 → 协议默认（Chat 只收文字）', () => {
    expect(autoImageInput('grok-4.7-fast-reasoning', 'chat')).toEqual({ images: true, reason: 'builtin' })
    expect(autoImageInput('xai/grok-4.7', 'chat')).toEqual({ images: true, reason: 'prefix' })
    expect(autoImageInput('qwen3-vl-plus', 'chat')).toEqual({ images: true, reason: 'vision' })
    expect(autoImageInput('grok-4', 'chat')).toEqual({ images: false, reason: 'protocol' })
    expect(autoImageInput('grok-4', 'responses')).toEqual({ images: true, reason: 'protocol' })
    expect(autoImageInput('devstral-latest', 'responses')).toEqual({ images: false, reason: 'builtin' })
  })
})
