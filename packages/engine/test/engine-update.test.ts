import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENGINES, isNewerVersion, type EngineInfo, type HostEvent } from '@pixelsky/protocol'
import { EngineHost, type EngineAdapter, type SessionContext } from '../src'
import { npmCliCandidates, npmPrefixOf } from '../src/codex/update'
import { makeTmp, removeTmp } from './helpers/tmp'

// 引擎一键更新（docs/ui/engine-update.md）：查最新版本、更新前关掉空闲进程、有任务在跑不更新、npm 路径

const roots: string[] = []
const hosts: EngineHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(h => h.shutdown()))
  roots.splice(0).forEach(removeTmp)
})

function setup(opts: { latest?: Record<string, string | null> } = {}) {
  const root = makeTmp('engine-update')
  roots.push(root)
  const events: HostEvent[] = []
  const contexts = new Map<string, SessionContext>()
  let closed = 0,
    updates = 0,
    version = '0.160.0'
  const adapter: EngineAdapter = {
    npmPackage: '@openai/codex',
    updateNeedsIdle: true,
    info: async () => ({ ...ENGINES.codex, status: 'ready', version, path: 'codex', message: null }) as EngineInfo,
    update: async () => {
      updates++
      version = '0.170.0'
      return { ok: true, output: 'added 1 package', version: null }
    },
    createSession: ctx => {
      contexts.set(ctx.record().id, ctx)
      return {
        send: () => {},
        interrupt: async () => {},
        answer: () => {},
        update: async () => {},
        stopTask: async () => {},
        taskOutput: async () => ({ output: '', truncated: false }),
        close: async () => {
          closed++
        },
      }
    },
  }
  const latest = vi.fn(async (pkg: string) => opts.latest?.[pkg] ?? null)
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    adapters: { codex: adapter },
    emit: e => events.push(e),
    latestVersion: latest,
  })
  hosts.push(host)
  const project = host.addProject(root)
  const create = () => host.createSession({ projectId: project.id, engine: 'codex' }).id
  return { host, events, contexts, create, latest, closed: () => closed, updates: () => updates }
}

describe('引擎有新版本', () => {
  it('查到比本机新的版本时带进引擎信息并广播；查不到的不广播', async () => {
    const { host, events, latest } = setup({ latest: { '@openai/codex': '0.170.0' } })
    await host.checkEngineUpdates()
    expect(latest).toHaveBeenCalledWith('@openai/codex')
    const codex = (await host.engines()).find(e => e.id === 'codex')!
    expect(codex.latestVersion).toBe('0.170.0')
    expect(isNewerVersion(codex.latestVersion, codex.version)).toBe(true)
    const broadcasts = events.filter(e => e.kind === 'engines')
    expect(broadcasts).toHaveLength(1)
    // 同一个版本再查一次不重复广播
    await host.checkEngineUpdates()
    expect(events.filter(e => e.kind === 'engines')).toHaveLength(1)
  })

  it('查询失败或没有结果时保持原样', async () => {
    const { host, events } = setup()
    await host.checkEngineUpdates()
    expect((await host.engines()).find(e => e.id === 'codex')!.latestVersion).toBeUndefined()
    expect(events.filter(e => e.kind === 'engines')).toHaveLength(0)
  })

  it('版本比较按前三段数字，后缀不计', () => {
    expect(isNewerVersion('2.1.300', '2.1.296')).toBe(true)
    expect(isNewerVersion('2.10.0', '2.9.9')).toBe(true)
    expect(isNewerVersion('2.1.296', '2.1.296')).toBe(false)
    expect(isNewerVersion('2.1.295', '2.1.296')).toBe(false)
    expect(isNewerVersion('0.1.4-beta', '0.1.4')).toBe(false)
    expect(isNewerVersion(undefined, '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', null)).toBe(false)
  })
})

describe('一键更新', () => {
  it('先关掉这个引擎空闲的进程，更新后重新检测版本', async () => {
    const { host, create, contexts, closed, updates } = setup({ latest: { '@openai/codex': '0.170.0' } })
    const id = create()
    await host.send(id, '你好')
    await vi.waitFor(() => expect(contexts.has(id)).toBe(true))
    const turnId = host.open(id).turnId!
    contexts.get(id)!.emit({ type: 'turn_completed', turnId, outcome: 'completed', error: null })
    await vi.waitFor(() => expect(host.open(id).state).toBe('idle'))

    const result = await host.updateEngine('codex')
    expect(closed()).toBe(1)
    expect(updates()).toBe(1)
    expect(result).toMatchObject({ ok: true, version: '0.170.0' })
  })

  it('有任务在跑时不更新', async () => {
    const { host, create, contexts, updates } = setup()
    const id = create()
    await host.send(id, '跑一个长任务')
    await vi.waitFor(() => expect(contexts.has(id)).toBe(true))
    await expect(host.updateEngine('codex')).rejects.toThrow('有这个引擎的任务正在运行')
    expect(updates()).toBe(0)
  })
})

describe('Codex 的 npm 安装位置', () => {
  it('Windows：原生程序在 <前缀>\\node_modules\\@openai\\codex 下', () => {
    const exe =
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'
    expect(npmPrefixOf(exe, true)).toBe('C:\\Users\\me\\AppData\\Roaming\\npm')
    expect(
      npmCliCandidates('C:\\Program Files\\nodejs\\node.exe', 'C:\\npm', true).map(p => p.replace(/\\/g, '/')),
    ).toEqual(['C:/npm/node_modules/npm/bin/npm-cli.js', 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js'])
  })

  it('Linux / macOS：<前缀>/lib/node_modules/@openai/codex', () => {
    expect(npmPrefixOf('/usr/local/lib/node_modules/@openai/codex/vendor/x/bin/codex', false)).toBe('/usr/local')
    expect(npmPrefixOf('/opt/odd/node_modules/@openai/codex/bin/codex', false)).toBeNull()
  })

  it('不是 npm 装的返回 null', () => {
    expect(npmPrefixOf('C:\\Users\\me\\.local\\bin\\codex.exe', true)).toBeNull()
    expect(npmPrefixOf('/usr/bin/codex', false)).toBeNull()
  })
})
