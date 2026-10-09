import { describe, expect, it } from 'vitest'
import { CLAUDE_COMPACT_MARKER, isClaudeCompaction, rewriteCompaction } from '../src'

const compactBody = (model: string, system: unknown = [{ type: 'text', text: `${CLAUDE_COMPACT_MARKER}.` }]) =>
  JSON.stringify({ model, system, messages: [{ role: 'user', content: 'Your task is to create a detailed summary of the conversation so far' }], stream: true })

describe('压缩请求换模型', () => {
  it('认出 Claude Code 的压缩请求（system 是字符串或文本块数组）', () => {
    expect(isClaudeCompaction(JSON.parse(compactBody('claude-opus-5-5')))).toBe(true)
    expect(isClaudeCompaction(JSON.parse(compactBody('claude-opus-5-5', `${CLAUDE_COMPACT_MARKER}.`)))).toBe(true)
    expect(isClaudeCompaction({ model: 'x', system: [{ type: 'text', text: 'You are Claude Code' }] })).toBe(false)
    expect(isClaudeCompaction(null)).toBe(false)
  })

  it('线路有压缩模型时换掉 model，其他字段不动', () => {
    const out = rewriteCompaction(compactBody('claude-opus-5-5'), 'claude-sonnet-5-5', ['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(out).not.toBeNull()
    const body = JSON.parse(out!) as { model: string; stream: boolean; messages: unknown[] }
    expect(body.model).toBe('claude-sonnet-5-5')
    expect(body.stream).toBe(true)
    expect(body.messages).toHaveLength(1)
  })

  it('没选、线路没有这个模型、不是压缩请求、模型相同、请求体坏了：原样转发', () => {
    const routes = ['claude-opus-5-5', 'claude-sonnet-5-5']
    expect(rewriteCompaction(compactBody('claude-opus-5-5'), null, routes)).toBeNull()
    expect(rewriteCompaction(compactBody('claude-opus-5-5'), 'claude-haiku-4-5', routes)).toBeNull()
    expect(rewriteCompaction(JSON.stringify({ model: 'claude-opus-5-5', system: 'You are Claude Code' }), 'claude-sonnet-5-5', routes)).toBeNull()
    expect(rewriteCompaction(compactBody('claude-sonnet-5-5'), 'claude-sonnet-5-5', routes)).toBeNull()
    expect(rewriteCompaction('{bad', 'claude-sonnet-5-5', routes)).toBeNull()
  })
})
