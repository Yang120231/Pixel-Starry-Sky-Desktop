import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('./account', () => ({ settingsFetch: vi.fn(), signedInEmail: () => 'alice@example.com' }))
const { MAX_KEYS, checkChanges, parseCloudSettings, readSettingsResponse } = await import('./settings-sync')

// 云端的契约样例（services/cloud/testdata/contract，docs/cloud-service.md §4.2.10）
const contractDir = fileURLToPath(new URL('../../../../../services/cloud/testdata/contract/', import.meta.url))
const sample = (name: string) =>
  JSON.parse(readFileSync(contractDir + name, 'utf8')) as { status: number; body: unknown }
const response = (s: { status: number; body: unknown }) =>
  new Response(JSON.stringify(s.body), { status: s.status, headers: { 'Content-Type': 'application/json' } })

describe('设置云同步：云端的设置', () => {
  it('桌面端的契约样例能解析，值原样保留（文本或对象）', async () => {
    const settings = await readSettingsResponse(response(sample('desktop/settings-put.json')))
    expect(Object.keys(settings).sort()).toEqual(['desktop.engine.options', 'desktop.engine.retries', 'desktop.theme'])
    expect(settings['desktop.theme']).toEqual({ value: 'dark', updatedAt: expect.any(Number) })
    expect(settings['desktop.engine.retries'].value).toBe(3)
  })

  it('旧版客户端的键（theme、ui.*）不读', async () => {
    const legacy = await readSettingsResponse(response(sample('legacy/settings-get.json')))
    expect(legacy).toEqual({})
    expect(
      parseCloudSettings({
        settings: {
          'ui.theme': { value: 'dark', updated_at: 1 },
          'desktop.ok': { value: 1, updated_at: 2 },
          'desktop.bad': { value: 1 },
          'desktop.no-value': { updated_at: 3 },
        },
      }),
    ).toEqual({ 'desktop.ok': { value: 1, updatedAt: 2 } })
  })

  it('云端回 400 时报出状态，5xx 时说连不上', async () => {
    await expect(readSettingsResponse(response(sample('desktop/settings-put-invalid.json')))).rejects.toThrow('400')
    await expect(readSettingsResponse(new Response('x', { status: 502 }))).rejects.toThrow('云端服务暂时连不上')
  })
})

describe('设置云同步：上传前的检查', () => {
  it('只允许 desktop.* 键、值不超过 64 KB、一次不超过 300 个', () => {
    expect(checkChanges({ 'desktop.theme': 'dark', 'desktop.fonts': null })).toEqual({
      'desktop.theme': 'dark',
      'desktop.fonts': null,
    })
    for (const bad of [
      { 'ui.theme': 'dark' },
      { 'desktop.a b': 1 },
      { 'desktop.big': 'x'.repeat(64 * 1024 + 1) },
      { 'desktop.fn': () => 1 },
      Object.fromEntries(Array.from({ length: MAX_KEYS + 1 }, (_, i) => [`desktop.k${i}`, i])),
      null,
      ['desktop.theme'],
    ])
      expect(() => checkChanges(bad)).toThrow()
  })
})
