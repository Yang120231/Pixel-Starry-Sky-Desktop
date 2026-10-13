import { describe, expect, it } from 'vitest'
import { shortModel } from './agentTrace'

describe('shortModel', () => {
  it('去掉 claude- 前缀', () => {
    expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5-5')
  })
  it('去掉厂商前缀和 [1m] 标记（GitHub #38）', () => {
    expect(shortModel('anthropic/claude-v4.1flash[1m]')).toBe('v4.1flash')
    expect(shortModel('openrouter/moonshotai/kimi-k3')).toBe('kimi-k3')
    expect(shortModel('claude-opus-5-5[1M]')).toBe('opus-5-5')
  })
  it('其他名字原样；去完为空时用原名', () => {
    expect(shortModel('gpt-5.5')).toBe('gpt-5.5')
    expect(shortModel('')).toBe('')
    expect(shortModel('anthropic/')).toBe('anthropic/')
  })
})
