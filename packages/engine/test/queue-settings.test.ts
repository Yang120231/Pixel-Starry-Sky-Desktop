import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '@pixelsky/protocol'
import { messageInput, queueSettings, sameQueueSettings } from '../src/queue'

const record = { model: 'm', effort: null, platform: null, provider: { id: 'p1' } } as unknown as SessionRecord
const id = () => 'c1'

describe('排队消息的额度来源（docs/ui/custom-api.md §4.2）', () => {
  it('自定义接口随排队项固定；换了接口算不同的设置，旧排队项没有 provider 按 null', () => {
    const s = queueSettings(record)
    expect(s.provider).toEqual({ id: 'p1' })
    expect(sameQueueSettings(s, { ...s, provider: { id: 'p2' } })).toBe(false)
    expect(sameQueueSettings({ model: 'm', effort: null, platform: null }, { ...s, provider: null })).toBe(true)
    expect(messageInput('hi', record, id).settings.provider).toEqual({ id: 'p1' })
  })

  it('接口 id 不对、和平台同时出现都拒绝', () => {
    const bad = (provider: unknown, platform: unknown = null) =>
      messageInput(
        { text: 'hi', clientMessageId: 'c1', settings: { model: null, effort: null, platform, provider } as never },
        record,
        id,
      )
    expect(() => bad({ id: '../x' })).toThrow('额度来源无效')
    expect(() => bad('p1')).toThrow('额度来源无效')
    expect(() => bad({ id: 'p1' }, { groupId: '7', account: 'a' })).toThrow('额度来源无效')
    expect(bad(undefined).settings.provider).toBeNull()
  })
})

describe('环境变量里的接口地址和 Key（docs/ui/custom-api.md §3.4）', () => {
  it('新增或修改被拒，已有的原样保留、删除都可以', async () => {
    const { EngineHost } = await import('../src')
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'env-reserved-'))
    const host = new EngineHost({ dataDir: dir, emit: () => undefined, adapters: {} })
    try {
      await expect(host.setEngineConfig('claude', { env: { ANTHROPIC_API_KEY: 'sk-new' } })).rejects.toThrow(
        'env.reserved',
      )
      await host.setEngineConfig('claude', { env: { HTTPS_PROXY: 'http://127.0.0.1:7890' } })
      expect(host.engineConfig().claude.env).toEqual({ HTTPS_PROXY: 'http://127.0.0.1:7890' })
    } finally {
      await host.shutdown()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
