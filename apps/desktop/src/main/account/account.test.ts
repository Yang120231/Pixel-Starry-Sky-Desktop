import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// 登录会话被云端吊销后，桌面端要马上退出登录；授权和换令牌时报设备名、版本号（管理页的登录会话里显示）。

const userData = mkdtempSync(join(tmpdir(), 'pixelsky-account-'))
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  opened: [] as string[],
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userData,
    getVersion: () => '9.9.9-test',
    on: () => undefined,
  },
  BrowserWindow: { getAllWindows: () => [] },
  // 测试里「加密」就是原样：只要读写对得上
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  shell: {
    openExternal: async (url: string) => {
      mocks.opened.push(url)
    },
  },
}))
vi.mock('../app/ui-language', () => ({ nativeText: (_w: unknown, v: string) => v, windowLocale: () => 'zh-CN' }))
vi.mock('../ipc/guard', () => ({
  handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
}))

const requests: Array<{ path: string; body: Record<string, unknown> | null }> = []
let revoked = false
vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
  const path = new URL(input).pathname
  requests.push({ path, body: typeof init.body === 'string' ? JSON.parse(init.body) : null })
  if (path === '/v1/oauth/token' && revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 })
  if (path.startsWith('/v1/platform/')) return Response.json({}, { status: revoked ? 401 : 200 })
  // 账号数据读不到只是暂时故障：保持登录
  return Response.json({}, { status: 503 })
})

writeFileSync(
  join(userData, 'account.json'),
  JSON.stringify({
    version: 1,
    data: Buffer.from(
      JSON.stringify({
        tokens: { accessToken: 'pss_a', refreshToken: 'pssr_r', accessExpiresAt: Date.now() + 3600_000 },
        account: { email: 'alice@example.com', name: 'Alice' },
      }),
    ).toString('base64'),
  }),
)

const { deviceName, initAccount, platformFetch, signedInEmail } = await import('./account')
vi.useFakeTimers({ toFake: ['setInterval'] })
initAccount()

afterAll(() => {
  vi.useRealTimers()
})

describe('登录会话', () => {
  it('被吊销后平台请求失败即退出登录，并报出原因；刷新令牌时带版本号', async () => {
    expect(signedInEmail()).toBe('alice@example.com')
    expect((await platformFetch('/v1/platform/groups')).status).toBe(200)

    revoked = true
    const error = await platformFetch('/v1/platform/groups').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'AUTH_EXPIRED', message: expect.stringContaining('请重新登录') })
    expect(signedInEmail()).toBeNull()
    expect(existsSync(join(userData, 'account.json'))).toBe(false)
    expect(requests.find(r => r.path === '/v1/oauth/token')?.body).toMatchObject({
      grant_type: 'refresh_token',
      client_version: '9.9.9-test',
    })
  })

  it('退出后重新登录：授权地址带设备名', async () => {
    void mocks.handlers.get('account:login')?.()
    await vi.waitFor(() => expect(mocks.opened).toHaveLength(1))
    expect(new URL(mocks.opened[0]).searchParams.get('device_name')).toBe(deviceName())
    expect(deviceName()).toMatch(/ · |^(Windows|macOS|Linux)/)
    await mocks.handlers.get('account:cancel')?.()
  })
})
