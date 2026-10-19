import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AccountQuota } from '@pixelsky/protocol'
import { I18nProvider } from '@/i18n/I18nProvider'
import { setCurrentLocale } from '@/i18n/core'

// 额度按钮和模型通道菜单里的简写共用的出现条件（设置、机器、引擎状态、登录方式）。依赖的 store 全换成可控的假值。

interface FakeEngine {
  id: 'claude' | 'codex'
  status: string
  auth?: { kind: string }
  account?: { email?: string }
}
const fake = vi.hoisted(() => ({
  currentId: 'local',
  engines: [] as FakeEngine[],
  enabled: true,
  quota: null as AccountQuota | null,
  snapshotAccount: undefined as string | null | undefined,
}))

vi.mock('@/features/settings/quotaDisplay', () => ({
  useQuotaDisplay: () => ({ enabled: fake.enabled, when: 'always', style: 'full' }),
}))
vi.mock('@/features/machines/store', () => ({
  machineOf: (id: unknown) =>
    typeof id === 'string' && /^(ssh|wsl)-[a-f0-9-]+~/.test(id) ? id.slice(0, id.indexOf('~')) : 'local',
  useMachines: () => ({ currentId: fake.currentId, machines: [] }),
}))
vi.mock('@/features/model-channels/loginStore', () => ({ useChannelEngines: () => fake.engines }))
vi.mock('@/features/account/useAccount', () => ({
  useAccount: () => ({ status: 'signed-in', account: null, refresh: async () => ({}) }),
}))
vi.mock('./quotaStore', async () => {
  const actual = await vi.importActual<typeof import('./quotaStore')>('./quotaStore')
  return {
    ...actual,
    useMinuteNow: () => new Date(2026, 9, 19, 14, 32).getTime(),
    useQuotaSnapshot: (_provider: string, account?: string | null) => {
      fake.snapshotAccount = account
      return fake.quota
    },
  }
})

import { useQuotaTarget } from './useQuotaTarget'
import { QuotaInline } from './QuotaInline'

const REMOTE = 'ssh-1234abcd'
const claude = (over: Partial<FakeEngine> = {}): FakeEngine => ({
  id: 'claude',
  status: 'ready',
  account: { email: 'a@example.com' },
  ...over,
})
const codex = (over: Partial<FakeEngine> = {}): FakeEngine => ({
  id: 'codex',
  status: 'ready',
  auth: { kind: 'chatgpt' },
  account: { email: 'c@example.com' },
  ...over,
})

function target(channel: 'claude' | 'chatgpt' | 'platform', sessionId: string | null) {
  let out: ReturnType<typeof useQuotaTarget> | undefined
  function Probe() {
    out = useQuotaTarget(channel, sessionId)
    return null
  }
  renderToStaticMarkup(<Probe />)
  return out!
}

const sample = (over: Partial<AccountQuota> = {}): AccountQuota => ({
  provider: 'chatgpt',
  status: 'ok',
  plan: 'plus',
  account: 'c@example.com',
  windows: [{ id: 'five_hour', durationMins: 300, usedPercent: 42, resetsAt: null }],
  extras: {},
  blocked: null,
  observedAt: null,
  fetchedAt: null,
  source: 'usage',
  refreshable: true,
  error: null,
  ...over,
})

function inline(provider: 'claude' | 'chatgpt'): string {
  vi.stubGlobal('localStorage', { getItem: () => 'zh-CN', setItem: () => undefined })
  return renderToStaticMarkup(
    <I18nProvider>
      <QuotaInline provider={provider} />
    </I18nProvider>,
  )
}

beforeEach(() => {
  fake.currentId = 'local'
  fake.engines = [claude(), codex()]
  fake.enabled = true
  fake.quota = null
  fake.snapshotAccount = undefined
  setCurrentLocale('zh-CN')
})

describe('useQuotaTarget', () => {
  it('本机对话：Claude / ChatGPT 授权带上引擎检测到的邮箱', () => {
    expect(target('claude', 's1')).toEqual({ provider: 'claude', accountKey: 'a@example.com' })
    expect(target('chatgpt', 's1')).toEqual({ provider: 'chatgpt', accountKey: 'c@example.com' })
  })
  it('本机对话、选中的是远程机器：引擎列表是远程那台的，不能拿来判断；Claude / ChatGPT 不显示，平台照旧', () => {
    fake.currentId = REMOTE
    // 这份列表是远程机器的：本机对话不能因为它「就绪」就显示
    expect(target('claude', 's1').provider).toBeNull()
    expect(target('chatgpt', 's1').provider).toBeNull()
    // 远程列表里 Codex 是 API Key：也不影响判断（不看它）
    fake.engines = [claude({ status: 'missing' }), codex({ auth: { kind: 'apiKey' } })]
    expect(target('claude', 's1').provider).toBeNull()
  })
  it('远程机器上的对话：一律不显示', () => {
    fake.currentId = REMOTE
    expect(target('claude', `${REMOTE}~s1`).provider).toBeNull()
  })
  it('还没开始的对话按输入框当前选的机器', () => {
    expect(target('claude', null).provider).toBe('claude')
    fake.currentId = REMOTE
    expect(target('claude', null).provider).toBeNull()
  })
  it('Codex 是 API Key / 自定义 provider：不显示', () => {
    fake.engines = [claude(), codex({ auth: { kind: 'apiKey' } })]
    expect(target('chatgpt', 's1').provider).toBeNull()
    fake.engines = [claude(), codex({ auth: { kind: 'provider' } })]
    expect(target('chatgpt', 's1').provider).toBeNull()
  })
  it('设置关掉：不显示', () => {
    fake.enabled = false
    expect(target('claude', 's1').provider).toBeNull()
  })
})

describe('QuotaInline 和按钮同样的出现条件', () => {
  it('ChatGPT 授权、有数据：显示简写，并把账号告诉存储', () => {
    fake.quota = sample()
    expect(inline('chatgpt')).toContain('5h 42%')
    expect(fake.snapshotAccount).toBe('c@example.com')
  })
  it('Codex 从 ChatGPT 登录改成 API Key：不再显示旧额度', () => {
    fake.quota = sample()
    expect(inline('chatgpt')).toContain('5h 42%')
    fake.engines = [claude(), codex({ auth: { kind: 'apiKey' } })]
    expect(inline('chatgpt')).toBe('')
  })
  it('引擎没就绪 / 设置关掉 / 选中远程机器：不显示', () => {
    fake.quota = sample({ provider: 'claude', account: 'a@example.com' })
    fake.engines = [claude({ status: 'missing' })]
    expect(inline('claude')).toBe('')
    fake.engines = [claude()]
    expect(inline('claude')).toContain('5h 42%')
    fake.enabled = false
    expect(inline('claude')).toBe('')
    fake.enabled = true
    fake.currentId = REMOTE
    expect(inline('claude')).toBe('')
    // 条件不满足时不把（远程机器的）账号告诉存储，免得误清本机数据
    expect(fake.snapshotAccount).toBeUndefined()
  })
})
