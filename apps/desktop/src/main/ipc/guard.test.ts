import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { IPC_CONTRACT, type IpcChannelSpec } from '@pixelsky/protocol'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true },
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  listeners: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  fromWebContents: vi.fn(),
}))
vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: {
    handle: (name: string, fn: (event: unknown, ...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
    on: (name: string, fn: (event: unknown, ...args: unknown[]) => unknown) => mocks.listeners.set(name, fn),
  },
}))

type Guard = typeof import('./guard')
const contract = IPC_CONTRACT as Record<string, IpcChannelSpec>
let guard: Guard

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.listeners.clear()
  mocks.app.isPackaged = true
  delete process.env.ELECTRON_RENDERER_URL
  vi.resetModules()
  guard = await import('./guard')
})

// ---------------------------------------------------------------------------
// 调用现场：一个来源页面 + 它所在的框架和窗口
// ---------------------------------------------------------------------------

interface Scene {
  url?: string | null
  subframe?: boolean
  window?: 'owner' | 'none' | 'destroyed' | 'other'
}
function scene({ url = 'file:///app/index.html', subframe = false, window = 'owner' }: Scene = {}): IpcMainInvokeEvent &
  IpcMainEvent {
  const mainFrame = { url: url ?? '' }
  const sender = { mainFrame }
  const win = { webContents: sender, isDestroyed: () => window === 'destroyed' }
  mocks.fromWebContents.mockReturnValue(
    window === 'none' ? null : window === 'other' ? { ...win, webContents: {} } : win,
  )
  return {
    sender,
    senderFrame: url === null ? null : subframe ? { url } : mainFrame,
  } as unknown as IpcMainInvokeEvent & IpcMainEvent
}

// ---------------------------------------------------------------------------
// 档位 × 现场 → 结果。列：
//   none / sender / frame：契约里的三档；
//   strict：window 档，默认；
//   loose：window 档 + looseOwner（终端）；
//   closing：window 档 + looseOwner + noWindow（窗口控制）。
// ---------------------------------------------------------------------------

type Outcome = 'ok' | 'untrusted' | 'noWindow'
type Column = 'none' | 'sender' | 'frame' | 'strict' | 'loose' | 'closing'
const scenes: {
  name: string
  scene: () => IpcMainInvokeEvent & IpcMainEvent
  dev?: boolean
  expected: Record<Column, Outcome>
}[] = [
  {
    name: '应用自己的页面（本地文件）',
    scene: () => scene(),
    expected: { none: 'ok', sender: 'ok', frame: 'ok', strict: 'ok', loose: 'ok', closing: 'ok' },
  },
  {
    name: '外部网页',
    scene: () => scene({ url: 'https://example.com/index.html' }),
    expected: {
      none: 'ok',
      sender: 'untrusted',
      frame: 'untrusted',
      strict: 'untrusted',
      loose: 'untrusted',
      closing: 'untrusted',
    },
  },
  {
    name: '没有来源框架',
    scene: () => scene({ url: null }),
    expected: {
      none: 'ok',
      sender: 'untrusted',
      frame: 'untrusted',
      strict: 'untrusted',
      loose: 'untrusted',
      closing: 'untrusted',
    },
  },
  {
    name: '子框架（地址可信但不是主框架）',
    scene: () => scene({ subframe: true }),
    expected: {
      none: 'ok',
      sender: 'ok',
      frame: 'untrusted',
      strict: 'untrusted',
      loose: 'untrusted',
      closing: 'untrusted',
    },
  },
  {
    name: '调用方没有窗口',
    scene: () => scene({ window: 'none' }),
    expected: { none: 'ok', sender: 'ok', frame: 'ok', strict: 'untrusted', loose: 'untrusted', closing: 'noWindow' },
  },
  {
    name: '窗口已销毁',
    scene: () => scene({ window: 'destroyed' }),
    expected: { none: 'ok', sender: 'ok', frame: 'ok', strict: 'ok', loose: 'ok', closing: 'noWindow' },
  },
  {
    name: '窗口的 webContents 不是调用方（内嵌网页视图）',
    scene: () => scene({ window: 'other' }),
    expected: { none: 'ok', sender: 'ok', frame: 'ok', strict: 'untrusted', loose: 'ok', closing: 'ok' },
  },
]

/** 每一列用哪个真实通道、怎样的选项注册，以及未受信时抛的文案。 */
const columns: Record<
  Column,
  { channel: string; kind: 'handle' | 'on'; options?: Record<string, unknown>; deny?: string; noWindow?: string }
> = {
  none: { channel: 'theme:set', kind: 'on' },
  sender: { channel: 'platform:groups', kind: 'handle', deny: '不受信任的页面' },
  frame: { channel: 'ui:locale', kind: 'handle', options: { deny: '不允许的调用方' }, deny: '不允许的调用方' },
  strict: { channel: 'machines:workspaces', kind: 'handle', deny: '不受信任的页面' },
  loose: { channel: 'terminal:state', kind: 'handle', options: { looseOwner: true }, deny: '不受信任的页面' },
  closing: {
    channel: 'window:getState',
    kind: 'handle',
    options: { deny: '不允许的调用方', noWindow: '窗口已经关闭', looseOwner: true },
    deny: '不允许的调用方',
    noWindow: '窗口已经关闭',
  },
}

describe('信任校验：档位 × 调用现场', () => {
  for (const [column, def] of Object.entries(columns) as [Column, (typeof columns)[Column]][]) {
    describe(`${column}（${def.channel}）`, () => {
      for (const { name, scene: make, expected } of scenes) {
        it(`${name} → ${expected[column]}`, () => {
          const fn = vi.fn(() => 'ran')
          const event = make()
          if (def.kind === 'handle') {
            ;(guard.handle as (c: string, f: typeof fn, o?: object) => void)(def.channel, fn, def.options)
            const registered = mocks.handlers.get(def.channel)!
            if (expected[column] === 'ok') {
              expect(registered(event, 1, 2)).toBe('ran')
              expect(fn).toHaveBeenCalledWith(event, 1, 2)
            } else {
              const message = expected[column] === 'noWindow' ? def.noWindow : def.deny
              expect(() => registered(event, 1, 2)).toThrow(new Error(message))
              expect(fn).not.toHaveBeenCalled()
            }
          } else {
            ;(guard.on as (c: string, f: typeof fn, o?: object) => void)(def.channel, fn, def.options)
            mocks.listeners.get(def.channel)!(event, 1, 2)
            // on 通道没有「抛错」这一说：未受信的调用一律静默忽略
            expect(fn).toHaveBeenCalledTimes(expected[column] === 'ok' ? 1 : 0)
          }
        })
      }
    })
  }

  it('on 通道（窗口档，终端）：未受信静默忽略，受信才执行', () => {
    for (const channel of ['terminal:ack', 'terminal:focused'] as const) {
      const fn = vi.fn()
      guard.on(channel, fn, { looseOwner: true })
      const listener = mocks.listeners.get(channel)!
      listener(scene({ url: 'https://example.com/' }), 'k')
      listener(scene({ subframe: true }), 'k')
      listener(scene({ window: 'none' }), 'k')
      expect(fn).not.toHaveBeenCalled()
      listener(scene({ window: 'other' }), 'k')
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  it('开发服务器页面：只有未打包且同源才受信', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    guard.handle('platform:groups', () => 'ran')
    const handler = mocks.handlers.get('platform:groups')!
    mocks.app.isPackaged = false
    expect(handler(scene({ url: 'http://localhost:5173/index.html' }))).toBe('ran')
    expect(() => handler(scene({ url: 'http://localhost:5174/index.html' }))).toThrow('不受信任的页面')
    expect(() => handler(scene({ url: 'http://evil.example/' }))).toThrow('不受信任的页面')
    mocks.app.isPackaged = true
    expect(() => handler(scene({ url: 'http://localhost:5173/index.html' }))).toThrow('不受信任的页面')
  })

  it('没有设置开发服务器地址时，网页地址不受信', () => {
    guard.handle('platform:groups', () => 'ran')
    mocks.app.isPackaged = false
    expect(() => mocks.handlers.get('platform:groups')!(scene({ url: 'http://localhost:5173/' }))).toThrow(
      '不受信任的页面',
    )
  })
})

describe('逐通道的拒绝方式', () => {
  const foreign = (): IpcMainInvokeEvent => scene({ url: 'https://example.com/' })
  const call = (channel: string, ...args: unknown[]): unknown => mocks.handlers.get(channel)!(foreign(), ...args)

  it('account:get 返回未登录，其余 account 通道静默忽略', async () => {
    const fn = vi.fn()
    guard.handle('account:get', fn, { onUntrusted: () => ({ status: 'signed-out' }) })
    expect(call('account:get')).toEqual({ status: 'signed-out' })
    for (const channel of ['account:login', 'account:cancel', 'account:logout', 'account:refresh'] as const) {
      guard.handle(channel, fn, { onUntrusted: () => undefined })
      expect(call(channel)).toBeUndefined()
    }
    expect(fn).not.toHaveBeenCalled()
  })
  it('notify:supported 返回 false', () => {
    guard.handle('notify:supported', () => true, { onUntrusted: () => false })
    expect(call('notify:supported')).toBe(false)
  })
  it('platform:models 抛「无效的分组」', () => {
    guard.handle('platform:models', () => [], { deny: '无效的分组' })
    expect(() => call('platform:models', '1')).toThrow('无效的分组')
  })
  it('默认抛「不受信任的页面」', () => {
    guard.handle('engine:engines', () => [])
    expect(() => call('engine:engines')).toThrow('不受信任的页面')
  })
})

describe('注册', () => {
  it('同一个通道不能注册两次（handle 与 on 都检测）', () => {
    guard.handle('platform:groups', () => 1)
    expect(() => guard.handle('platform:groups', () => 2)).toThrow('IPC 通道重复注册：platform:groups')
    guard.on('theme:set', () => undefined)
    expect(() => guard.on('theme:set', () => undefined)).toThrow('IPC 通道重复注册：theme:set')
    expect(mocks.handlers.size).toBe(1)
    expect(mocks.listeners.size).toBe(1)
  })
  it('动态注册（artifacts:open / reveal）各自只注册一次', () => {
    for (const action of ['open', 'reveal'] as const) guard.handle(`artifacts:${action}`, () => action)
    expect([...mocks.handlers.keys()].sort()).toEqual(['artifacts:open', 'artifacts:reveal'])
    expect(() => guard.handle('artifacts:open', () => 1)).toThrow('重复注册')
  })
  it('通道必须在契约里，且类型对得上', () => {
    expect(() => guard.handle('nope:nothing' as never, () => 1)).toThrow('不在契约里')
    expect(() => guard.handle('toString' as never, () => 1)).toThrow('不在契约里')
    expect(() => guard.handle('theme:set' as never, () => 1)).toThrow('不能这样注册')
    expect(() => guard.on('platform:groups' as never, () => 1)).toThrow('不能这样注册')
    expect(() => guard.on('account:changed' as never, () => 1)).toThrow('不能这样注册')
    expect(mocks.handlers.size + mocks.listeners.size).toBe(0)
  })
  it('契约里每个 invoke / send 通道都能注册，档位取自契约', () => {
    for (const [channel, spec] of Object.entries(contract)) {
      if (spec.kind === 'invoke') guard.handle(channel as never, () => 'ran')
      else if (spec.kind !== 'push') guard.on(channel as never, () => undefined)
    }
    const invokes = Object.values(contract).filter(spec => spec.kind === 'invoke').length
    expect(mocks.handlers.size).toBe(invokes)
    // 不校验的档位只能是 on 通道或 push；所有 invoke 通道至少要验来源页面
    for (const [channel, spec] of Object.entries(contract))
      if (spec.kind === 'invoke') {
        expect(spec.trust, channel).not.toBe('none')
        expect(() => mocks.handlers.get(channel)!(scene({ url: 'https://example.com/' })), channel).toThrow()
      }
  })
})

describe('卡顿诊断（docs/ui/logging.md §4.9）', () => {
  async function sink() {
    const lines: { level: string; scope: string; message: string; fields?: Record<string, unknown> }[] = []
    const engine = await import('@pixelsky/engine')
    engine.setLogSink({
      enabled: () => true,
      write: (level, scope, message, fields) => lines.push({ level, scope, message, fields }),
    })
    return lines
  }

  it('没处理完的 invoke 请求列在 ipcInFlight 里，处理完（成功或失败）就去掉', async () => {
    let finish!: (v: string) => void
    guard.handle('platform:groups', () => new Promise<string>(r => (finish = r)))
    guard.handle('platform:models', () => Promise.reject(new Error('坏了')))
    const pending = mocks.handlers.get('platform:groups')!(scene()) as Promise<string>
    expect(guard.ipcInFlight().map(c => c.channel)).toEqual(['platform:groups'])
    await expect(mocks.handlers.get('platform:models')!(scene(), '1') as Promise<unknown>).rejects.toThrow('坏了')
    expect(guard.ipcInFlight().map(c => c.channel)).toEqual(['platform:groups'])
    finish('ok')
    await expect(pending).resolves.toBe('ok')
    expect(guard.ipcInFlight()).toEqual([])
  })

  it('处理函数同步部分超过 500 毫秒记一条 warn；快的不记', async () => {
    const lines = await sink()
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    try {
      guard.handle('platform:groups', () => {
        clock += 800
        return 'slow'
      })
      guard.on('log:write', () => {
        clock += 10
      })
      expect(mocks.handlers.get('platform:groups')!(scene())).toBe('slow')
      mocks.listeners.get('log:write')!(scene())
    } finally {
      now.mockRestore()
    }
    expect(lines).toEqual([
      {
        level: 'warn',
        scope: 'perf',
        message: 'IPC 处理占住了主进程',
        fields: { channel: 'platform:groups', ms: 800 },
      },
    ])
    expect(guard.ipcInFlight()).toEqual([])
  })
})
