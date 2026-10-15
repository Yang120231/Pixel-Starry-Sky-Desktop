import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ENGINES, parseCodedError, type EngineInfo, type EngineLogin, type HostEvent } from '@pixelsky/protocol'
import { EngineHost, type EngineAdapter } from '../src'
import { runInteractive } from '../src/exec'
import { makeTmp, removeTmp } from './helpers/tmp'

// 引擎授权登录（docs/ui/model-channels.md §3），用假的登录命令

const fake = fileURLToPath(new URL('./fakes/fake-login.mjs', import.meta.url))
const roots: string[] = []
const hosts: EngineHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(h => h.shutdown()))
  roots.splice(0).forEach(removeTmp)
})

function setup(mode: string, opts: { loginTimeoutMs?: number; readyAfter?: boolean } = {}) {
  const root = makeTmp('engine-login')
  roots.push(root)
  const events: HostEvent[] = []
  let signedIn = false
  const adapter: EngineAdapter = {
    info: async () =>
      ({
        ...ENGINES.claude,
        status: signedIn ? 'ready' : 'unauthenticated',
        version: '2.1.300',
        path: 'claude',
        message: signedIn ? null : '还没登录 Claude Code',
      }) as EngineInfo,
    login: async (_method, onLine) => {
      const p = runInteractive({ command: process.execPath, args: [fake] }, [mode], process.env, onLine)
      // 先于宿主的 done 回调登记，宿主重新检测时已经是登录状态
      void p.done.then(r => {
        if (r.ok && opts.readyAfter !== false) signedIn = true
      })
      return p
    },
    createSession: () => {
      throw new Error('不开会话')
    },
  }
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    adapters: { claude: adapter },
    emit: e => events.push(e),
    loginTimeoutMs: opts.loginTimeoutMs,
  })
  hosts.push(host)
  const logins = (): EngineLogin[] => events.flatMap(e => (e.kind === 'engine_login' ? [e.login] : []))
  const until = async (test: (l: EngineLogin) => boolean): Promise<EngineLogin> => {
    for (let i = 0; i < 300; i++) {
      const hit = logins().find(test)
      if (hit) return hit
      await new Promise(r => setTimeout(r, 20))
    }
    throw new Error('等不到：' + JSON.stringify(logins().at(-1)))
  }
  return { host, events, logins, until }
}

describe('授权登录', () => {
  it('网址 → 等授权码 → 粘贴 → 重新检测 → done', async () => {
    const { host, events, logins, until } = setup('code')
    const first = host.loginEngine('claude')
    expect(first).toMatchObject({ engine: 'claude', method: 'browser', phase: 'starting' })
    const waiting = await until(l => l.awaitingCode)
    expect(waiting.url).toBe('https://claude.com/cai/oauth/authorize?code=true&state=abc')
    host.loginInput('claude', ' good \n')
    const done = await until(l => l.phase === 'done')
    expect(done.error).toBeNull()
    expect(logins().map(l => l.phase)).toContain('verify')
    expect(logins().at(-1)!.awaitingCode).toBe(false)
    expect(events.some(e => e.kind === 'engines')).toBe(true)
  })

  it('命令自己成功退出（浏览器回调）：done', async () => {
    const { host, until } = setup('exit')
    host.loginEngine('claude')
    await until(l => l.phase === 'done')
  })

  it('退出码非 0：failed，带最后一行输出', async () => {
    const { host, until } = setup('code')
    host.loginEngine('claude')
    await until(l => l.awaitingCode)
    host.loginInput('claude', 'bad')
    const failed = await until(l => l.phase === 'failed')
    expect(failed.error).toBe('got bad')
  })

  it('命令成功退出但检测仍没登录：failed，带引擎的说明', async () => {
    const { host, until } = setup('exit', { readyAfter: false })
    host.loginEngine('claude')
    const failed = await until(l => l.phase === 'failed')
    expect(failed.error).toBe('还没登录 Claude Code')
  })

  it('取消：cancelled，之后可以再登录', async () => {
    const { host, until, logins } = setup('hang')
    host.loginEngine('claude')
    await until(l => l.url !== null)
    host.cancelLogin('claude')
    await until(l => l.phase === 'cancelled')
    expect(() => host.loginInput('claude', 'x')).toThrow('没有正在进行的登录')
    expect(host.loginEngine('claude').phase).toBe('starting')
    expect(logins().filter(l => l.phase === 'starting')).toHaveLength(2)
  })

  it('超时：杀掉命令，failed', async () => {
    const { host, until } = setup('hang', { loginTimeoutMs: 300 })
    host.loginEngine('claude')
    const failed = await until(l => l.phase === 'failed')
    expect(failed.error).toBe('超时：10 分钟内没有完成登录')
  })

  it('已经在登录：再点一次返回同一个进度，不起第二个命令', async () => {
    const { host, until, logins } = setup('hang')
    host.loginEngine('claude')
    await until(l => l.url !== null)
    const again = host.loginEngine('claude')
    expect(again.url).not.toBeNull()
    expect(logins().filter(l => l.phase === 'starting')).toHaveLength(1)
  })

  it('取消授权后重新检测仍然可用：不当成功，说明原因', async () => {
    const root = makeTmp('engine-logout')
    roots.push(root)
    let auth: EngineInfo['auth'] = { kind: 'provider', provider: 'relay' }
    let signedIn = true
    const adapter: EngineAdapter = {
      info: async () =>
        ({
          ...ENGINES.codex,
          status: 'ready',
          version: '0.162.1',
          path: 'codex',
          message: null,
          auth,
          ...(signedIn ? {} : { status: 'unauthenticated' }),
        }) as EngineInfo,
      logout: async () => ({ ok: true, output: 'Not logged in', version: null }),
      createSession: () => {
        throw new Error('不开会话')
      },
    }
    const host = new EngineHost({ dataDir: join(root, 'data'), adapters: { codex: adapter }, emit: () => {} })
    hosts.push(host)
    const provider = await host.logoutEngine('codex')
    expect(provider.ok).toBe(false)
    expect(parseCodedError(provider.output)).toEqual({
      code: 'engine.logoutProvider',
      params: { engine: 'Codex', provider: 'relay' },
    })
    auth = { kind: 'apiKey' }
    expect(parseCodedError((await host.logoutEngine('codex')).output)?.code).toBe('engine.logoutStillReady')
    signedIn = false
    expect(await host.logoutEngine('codex')).toMatchObject({ ok: true, version: '0.162.1' })
  })

  it('不支持登录的引擎抛出', () => {
    const { host } = setup('exit')
    expect(() => host.loginEngine('codex')).toThrow('这个引擎不支持在应用里登录')
  })
})
