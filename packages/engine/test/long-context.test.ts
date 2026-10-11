// 上下文超过 200K 的自定义模型带 [1m] 启动（docs/ui/custom-api.md §10）
import { describe, expect, it } from 'vitest'
import { LONG_CONTEXT_ENV, claudeModelName } from '../src'
import { ContextReader } from '../src/claude/context'
import type { EngineEvent } from '@pixelsky/protocol'

describe('长上下文的自定义模型', () => {
  it('在名单里的加 [1m]，已经带了的不重复加；没名单、名单坏了照原样', () => {
    const env = { [LONG_CONTEXT_ENV]: JSON.stringify(['anthropic/claude-v4.1flash']) }
    expect(claudeModelName('anthropic/claude-v4.1flash', env)).toBe('anthropic/claude-v4.1flash[1m]')
    expect(claudeModelName('anthropic/claude-v4.1flash[1m]', env)).toBe('anthropic/claude-v4.1flash[1m]')
    expect(claudeModelName('deepseek-chat', env)).toBe('deepseek-chat')
    expect(claudeModelName('anthropic/claude-v4.1flash', {})).toBe('anthropic/claude-v4.1flash')
    expect(claudeModelName('anthropic/claude-v4.1flash', { [LONG_CONTEXT_ENV]: 'oops' })).toBe(
      'anthropic/claude-v4.1flash',
    )
  })

  it('上下文面板的上限按 get_context_usage 报的（配置值），result 里 [1m] 报的 1M 不覆盖', () => {
    const events: EngineEvent[] = []
    const reader = new ContextReader(e => events.push(e))
    const window = () => {
      const last = events.filter(e => e.type === 'context').at(-1)
      return last?.type === 'context' ? last.context?.window : undefined
    }
    reader.diagnostic({
      model: 'anthropic/claude-v4.1flash[1m]',
      totalTokens: 31_000,
      maxTokens: 272_000,
      rawMaxTokens: 272_000,
      categories: [],
    })
    expect(window()).toBe(272_000)
    // 请求回来的模型名不带后缀
    reader.handle({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { id: 'm1', model: 'anthropic/claude-v4.1flash', usage: { input_tokens: 10 } },
      },
    })
    reader.handle({
      type: 'result',
      modelUsage: { 'anthropic/claude-v4.1flash[1m]': { contextWindow: 1_000_000 } },
    })
    expect(window()).toBe(272_000)
  })
})
