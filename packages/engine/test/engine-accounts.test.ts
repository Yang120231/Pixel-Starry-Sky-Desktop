// 订阅账号多开（docs/ui/engine-accounts.md、engine-accounts-claude.md）：账号目录接回原目录、宿主的添加 / 切换 / 移除、
// 额度用完自动换账号（Codex、Claude 同一套）、提示条的字段、额度恢复后换回
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENGINES, type EngineAccounts, type EngineInfo, type HostEvent, type Item } from '@pixelsky/protocol'
import { EngineHost, type EngineAdapter } from '../src'
import type { AccountProbe, LoginProcess, SessionContext } from '../src/adapter'
import { removeOwnFiles } from '../src/accounts-home'
import { forgetCodexAccount, prepareAccountHome } from '../src/codex/accounts'
import { readAccountsFile } from '../src/host/accounts'
import { makeTmp, removeTmp } from './helpers/tmp'

const roots: string[] = []
const hosts: EngineHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(h => h.shutdown()))
  roots.splice(0).forEach(removeTmp)
})
const tmp = (name: string): string => {
  const dir = makeTmp(name)
  roots.push(dir)
  return dir
}

describe('账号目录接回原目录', () => {
  it('文件夹链过去、文件硬链接，凭据不共享；删掉账号目录不动原目录', () => {
    const root = tmp('accounts-home')
    const real = join(root, 'codex'),
      dir = join(root, 'acc')
    mkdirSync(join(real, 'sessions', '2026'), { recursive: true })
    writeFileSync(join(real, 'sessions', '2026', 'rollout.jsonl'), 'x')
    writeFileSync(join(real, 'config.toml'), 'model = "a"\n')
    writeFileSync(join(real, 'auth.json'), '{"secret":1}')
    prepareAccountHome(real, dir)
    expect(readFileSync(join(dir, 'sessions', '2026', 'rollout.jsonl'), 'utf8')).toBe('x')
    // 硬链接：账号目录里追加，原目录里看得到
    writeFileSync(join(dir, 'config.toml'), 'model = "b"\n')
    expect(readFileSync(join(real, 'config.toml'), 'utf8')).toBe('model = "b"\n')
    expect(existsSync(join(dir, 'auth.json'))).toBe(false)
    // 账号里新建的会话写进原目录
    writeFileSync(join(dir, 'sessions', 'new.jsonl'), 'y')
    expect(readFileSync(join(real, 'sessions', 'new.jsonl'), 'utf8')).toBe('y')
    rmSync(dir, { recursive: true, force: true })
    expect(readFileSync(join(real, 'sessions', '2026', 'rollout.jsonl'), 'utf8')).toBe('x')
    expect(existsSync(join(real, 'config.toml'))).toBe(true)
  })

  it('Codex 整个重写了 config.toml（链接断开）：新内容拷回原目录再重新链上；再调一次不变', () => {
    const root = tmp('accounts-home')
    const real = join(root, 'codex'),
      dir = join(root, 'acc')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'config.toml'), 'old\n')
    prepareAccountHome(real, dir)
    rmSync(join(dir, 'config.toml'))
    writeFileSync(join(dir, 'config.toml'), 'new\n')
    const later = new Date(Date.now() + 5000)
    utimesSync(join(dir, 'config.toml'), later, later)
    prepareAccountHome(real, dir)
    expect(readFileSync(join(real, 'config.toml'), 'utf8')).toBe('new\n')
    const a = statSync(join(real, 'config.toml'), { bigint: true }),
      b = statSync(join(dir, 'config.toml'), { bigint: true })
    expect(a.ino).toBe(b.ino)
    prepareAccountHome(real, dir)
    expect(readFileSync(join(dir, 'config.toml'), 'utf8')).toBe('new\n')
  })

  it('链上之前 Codex 自己建了文件夹：里面的东西挪回原目录', () => {
    const root = tmp('accounts-home')
    const real = join(root, 'codex'),
      dir = join(root, 'acc')
    mkdirSync(join(dir, 'skills'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'mine.md'), 'm')
    prepareAccountHome(real, dir)
    expect(readFileSync(join(real, 'skills', 'mine.md'), 'utf8')).toBe('m')
    expect(readFileSync(join(dir, 'skills', 'mine.md'), 'utf8')).toBe('m')
  })

  it('删除账号只删账号目录里自己的凭据文件：接回原目录的文件夹、路径里带分隔符的名字一律不碰', () => {
    const root = tmp('accounts-forget')
    const real = join(root, 'codex'),
      dir = join(root, 'acc')
    mkdirSync(join(real, 'sessions'), { recursive: true })
    writeFileSync(join(real, 'sessions', 'auth.json'), 'keep')
    writeFileSync(join(real, 'auth.json'), '{"original":1}')
    prepareAccountHome(real, dir)
    writeFileSync(join(dir, 'auth.json'), '{"account":1}')
    expect(forgetCodexAccount(dir)).toEqual(['auth.json'])
    expect(existsSync(join(dir, 'auth.json'))).toBe(false)
    expect(readFileSync(join(real, 'auth.json'), 'utf8')).toBe('{"original":1}')
    // 链接、文件夹、带路径的名字：什么都不删
    expect(removeOwnFiles(dir, ['sessions', '..', 'sessions/auth.json', join('sessions', 'auth.json')])).toEqual([])
    expect(readFileSync(join(real, 'sessions', 'auth.json'), 'utf8')).toBe('keep')
    expect(existsSync(join(dir, 'sessions'))).toBe(true)
  })

  it('账号目录建不起来：不抛错，返回 false 让调用方下次再试；建得起来返回 true', () => {
    const root = tmp('accounts-home')
    const real = join(root, 'codex'),
      blocker = join(root, 'blocker')
    // 父路径是个文件：mkdir 失败
    writeFileSync(blocker, '')
    expect(prepareAccountHome(real, join(blocker, 'acc'))).toBe(false)
    rmSync(blocker)
    expect(prepareAccountHome(real, join(blocker, 'acc'))).toBe(true)
  })
})

describe('账号文件', () => {
  it('不合法的项丢掉，当前账号不在列表里时回到原来的；自动切换默认关', () => {
    const file = readAccountsFile({
      codex: {
        current: 'a_000000000000',
        accounts: [{ id: 'default', email: 'a@x.com' }, { id: '../evil' }, { id: 'a_111111111111', status: 'ok' }],
        auto: { enabled: 'yes' },
      },
    })
    expect(file.codex?.current).toBe('default')
    expect(file.codex?.accounts.map(a => a.id)).toEqual(['default', 'a_111111111111'])
    expect(file.codex?.auto).toEqual({ enabled: false, order: 'list', switchBack: true, notice: true })
  })

  it('原来的账号隐藏着：要还有添加的账号才成立，列表里不留它，当前账号不会落回它；待删凭据只留合法的 id', () => {
    const file = readAccountsFile({
      codex: {
        current: 'default',
        hideDefault: true,
        cleanup: ['a_222222222222', 'a_111111111111', 'bad', 'a_222222222222', 3],
        accounts: [
          { id: 'default', email: 'me@example.com' },
          { id: 'a_111111111111', email: 'work@example.com' },
        ],
      },
      claude: { current: 'default', hideDefault: true, accounts: [{ id: 'default', email: 'me@example.com' }] },
    })
    expect(file.codex?.accounts.map(a => a.id)).toEqual(['a_111111111111'])
    expect(file.codex?.current).toBe('a_111111111111')
    expect(file.codex?.hideDefault).toBe(true)
    // 还在列表里的不算待删
    expect(file.codex?.cleanup).toEqual(['a_222222222222'])
    expect(file.claude?.hideDefault).toBe(false)
    expect(file.claude?.accounts.map(a => a.id)).toEqual(['default'])
  })
})

/** 假引擎：每个账号目录一个邮箱；会话按创建次序决定这一轮是额度用完还是正常完成 */
function setup(
  opts: {
    limited?: (session: number) => boolean
    engine?: 'codex' | 'claude'
    /** 额度用完时顺带报的恢复时间（会话的额度事件，宿主按原账号记下） */
    resetsAt?: () => number
    /** 适配器报某个账号目录还有进程在用 */
    inUse?: (dir: string) => boolean
  } = {},
) {
  const engine = opts.engine ?? 'codex'
  const root = tmp('accounts-host')
  const events: HostEvent[] = []
  const emails = new Map<string | null, string>([[null, 'me@example.com']])
  let nextEmail = 'work@example.com'
  const loggedOut: (string | null)[] = []
  const forgotten: string[] = []
  const sends: { session: number; text: string }[] = []
  let sessions = 0
  const done = (): LoginProcess => ({
    write() {},
    kill() {},
    done: Promise.resolve({ ok: true, started: true, stdout: '', stderr: '', error: null }),
  })
  const adapter: EngineAdapter = {
    info: async () =>
      ({
        ...ENGINES[engine],
        status: 'ready',
        version: 'test',
        path: engine,
        message: null,
        account: { email: 'me@example.com', plan: 'plus' },
      }) as EngineInfo,
    login: async () => done(),
    ...(opts.inUse ? { accountInUse: opts.inUse } : {}),
    accountLogin: async dir => {
      emails.set(dir, nextEmail)
      return done()
    },
    accountLogout: async dir => {
      loggedOut.push(dir)
      emails.delete(dir)
      return { ok: true, output: '', version: null }
    },
    accountForget: dir => {
      forgotten.push(dir)
      emails.delete(dir)
    },
    accountProbe: async (dir): Promise<AccountProbe> => {
      const email = emails.get(dir) ?? null
      return {
        signedIn: !!email,
        email,
        plan: 'plus',
        quota: email
          ? {
              kind: 'ok',
              plan: 'plus',
              account: email,
              windows: [{ id: 'five_hour', durationMins: 300, usedPercent: 10, resetsAt: null }],
              extras: {},
              blocked: null,
              observedAt: Date.now(),
            }
          : null,
      }
    },
    createSession: (ctx: SessionContext) => {
      const n = ++sessions
      return {
        send: (text, turnId) => {
          sends.push({ session: n, text })
          setTimeout(() => {
            if (opts.limited?.(n)) {
              if (opts.resetsAt)
                ctx.reportQuota?.({
                  windows: [
                    { id: 'five_hour', durationMins: 300, usedPercent: 100, resetsAt: opts.resetsAt(), rejected: true },
                  ],
                  observedAt: Date.now(),
                })
              ctx.emit({
                type: 'item_completed',
                item: {
                  kind: 'notice',
                  id: `limit-${n}`,
                  level: 'error',
                  text: 'You have hit your usage limit',
                  error: { kind: 'balance', code: 'usageLimitExceeded' },
                },
              })
              ctx.emit({ type: 'turn_completed', turnId, outcome: 'failed', error: 'You have hit your usage limit' })
            } else {
              ctx.emit({
                type: 'item_completed',
                item: { kind: 'assistant', id: `a-${n}-${turnId}`, text: 'ok' } as Item,
              })
              ctx.emit({ type: 'turn_completed', turnId, outcome: 'completed', error: null })
            }
          }, 5)
        },
        interrupt: async () => {},
        answer: () => {},
        update: async () => {},
        close: async () => {},
      }
    },
  }
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    adapters: { [engine]: adapter },
    emit: e => events.push(e),
  })
  hosts.push(host)
  const accountsEvents = (): EngineAccounts[] => events.flatMap(e => (e.kind === 'engine_accounts' ? [e.accounts] : []))
  const addAccount = async (email: string): Promise<EngineAccounts> => {
    nextEmail = email
    const before = accountsEvents().length
    host.addAccount(engine)
    await vi.waitFor(() => expect(accountsEvents().length).toBeGreaterThan(before))
    return accountsEvents().at(-1)!
  }
  return {
    root,
    host,
    engine,
    events,
    emails,
    addAccount,
    loggedOut,
    forgotten,
    sends,
    sessions: () => sessions,
    accountsEvents,
  }
}

describe('宿主的账号列表', () => {
  it('只有原来的登录时列一项；添加账号后原来的排第一，不换当前账号；同一邮箱不重复添加', async () => {
    const { host, addAccount, events, loggedOut, forgotten } = setup()
    expect((await host.accounts('codex')).accounts.map(a => a.email)).toEqual(['me@example.com'])
    const list = await addAccount('work@example.com')
    expect(list.accounts.map(a => a.email)).toEqual(['me@example.com', 'work@example.com'])
    expect(list.current).toBe('default')
    // 再登录一次同一个邮箱：报错，新目录里刚写的凭据删掉（不跑退出登录）
    host.addAccount('codex')
    await vi.waitFor(() => expect(events.some(e => e.kind === 'engine_login' && e.login.phase === 'failed')).toBe(true))
    const failed = events.findLast(e => e.kind === 'engine_login')
    expect(failed?.kind === 'engine_login' && failed.login.error).toMatch(/已经在列表里/)
    expect(loggedOut).toEqual([])
    expect(forgotten).toHaveLength(1)
    expect((await host.accounts('codex')).accounts).toHaveLength(2)
  })

  it('切换后下一条消息换进程；删除当前账号：先换到别的账号、不退出登录；删完只剩原来的就回到单账号', async () => {
    const env = setup()
    const { host, addAccount } = env
    const list = await addAccount('work@example.com')
    const work = list.accounts[1].id
    const project = host.addProject(env.root)
    const id = host.createSession({ projectId: project.id, engine: 'codex' }).id
    await host.send(id, '第一条')
    await vi.waitFor(() => expect(host.open(id).state).toBe('idle'))
    await host.switchAccount('codex', work)
    await host.send(id, '第二条')
    await vi.waitFor(() => expect(env.sends).toHaveLength(2))
    expect(env.sends.map(s => s.session)).toEqual([1, 2])
    const after = await host.removeAccount('codex', work)
    expect(after.accounts).toEqual([])
    expect(after.current).toBe('default')
    expect(env.loggedOut).toEqual([])
    expect(env.forgotten).toHaveLength(1)
    // 下一条消息用原来的账号，换进程接上
    await vi.waitFor(() => expect(host.open(id).state).toBe('idle'))
    await host.send(id, '第三条')
    await vi.waitFor(() => expect(env.sends).toHaveLength(3))
    expect(env.sends.map(s => s.session)).toEqual([1, 2, 3])
  })

  it('还有对话的进程在用（换账号之前开的）：照样能删，凭据文件等进程没了再删；从不退出登录', async () => {
    let busy = true
    const env = setup({ inUse: () => busy })
    const list = await env.addAccount('work@example.com')
    const work = list.accounts[1].id
    expect((await env.host.removeAccount('codex', work)).accounts).toEqual([])
    expect(env.forgotten).toEqual([])
    await env.host.accounts('codex')
    expect(env.forgotten).toEqual([])
    busy = false
    await env.host.accounts('codex')
    expect(env.forgotten).toHaveLength(1)
    await env.host.accounts('codex')
    expect(env.forgotten).toHaveLength(1)
    expect(env.loggedOut).toEqual([])
  })

  it('删除原来的账号只是隐藏：不退出登录、换到添加的账号、不再列出；「显示原来的账号」放回来；删完添加的账号原来的自动回来', async () => {
    const env = setup()
    const list = await env.addAccount('work@example.com')
    const work = list.accounts[1].id
    const hidden = await env.host.removeAccount('codex', 'default')
    expect(hidden.accounts.map(a => a.id)).toEqual([work])
    expect(hidden).toMatchObject({ current: work, defaultHidden: true })
    expect(env.loggedOut).toEqual([])
    expect(env.forgotten).toEqual([])
    // 重新检测、读额度都不会把它放回来
    expect((await env.host.accounts('codex')).accounts.map(a => a.id)).toEqual([work])
    expect((await env.host.accountsQuota('codex', true)).map(r => r.id)).toEqual([work])
    const shown = await env.host.showDefaultAccount('codex')
    expect(shown.accounts.map(a => a.id)).toEqual(['default', work])
    expect(shown.accounts[0]).toMatchObject({ email: 'me@example.com', status: 'ok' })
    expect(shown).toMatchObject({ current: work, defaultHidden: false })
    // 再隐藏，然后删掉唯一添加的账号：原来的回来，回到单账号
    await env.host.removeAccount('codex', 'default')
    const back = await env.host.removeAccount('codex', work)
    expect(back).toMatchObject({ current: 'default', accounts: [], defaultHidden: false })
    expect(env.loggedOut).toEqual([])
  })

  it('别的账号都失效了：原来的账号不能删（不然没有账号可用）', async () => {
    const env = setup()
    const list = await env.addAccount('work@example.com')
    expect(list.accounts).toHaveLength(2)
    // 添加的账号目录里的登录没了（登录失效）
    for (const [dir] of env.emails) if (dir) env.emails.delete(dir)
    await env.host.accountsQuota('codex', true)
    expect((await env.host.accounts('codex')).accounts[1].status).toBe('expired')
    await expect(env.host.removeAccount('codex', 'default')).rejects.toThrow(/没有别的可用账号/)
  })

  it('额度：每个账号读一次，60 秒内用缓存', async () => {
    const { host, addAccount } = setup()
    await addAccount('work@example.com')
    const rows = await host.accountsQuota('codex', true)
    expect(rows.map(r => r.windows[0]?.usedPercent)).toEqual([10, 10])
  })
})

describe('额度用完自动换账号', () => {
  async function send(env: ReturnType<typeof setup>) {
    const project = env.host.addProject(env.root)
    const record = env.host.createSession({ projectId: project.id, engine: env.engine })
    await env.host.send(record.id, '改一下按钮颜色')
    return record.id
  }

  it('默认关：额度用完就是失败，不换账号', async () => {
    const env = setup({ limited: n => n === 1 })
    await env.addAccount('work@example.com')
    const id = await send(env)
    await vi.waitFor(() => expect(env.host.open(id).queue[0]?.status).toBe('failed'))
    expect((await env.host.accounts('codex')).current).toBe('default')
    expect(env.sessions()).toBe(1)
  })

  it('打开后：换到下一个账号、对话里提示一句，这条用新账号的进程重新派发', async () => {
    const env = setup({ limited: n => n === 1 })
    const list = await env.addAccount('work@example.com')
    env.host.setAccountAuto('codex', { enabled: true })
    const id = await send(env)
    await vi.waitFor(() => expect(env.sends).toHaveLength(2))
    await vi.waitFor(() => expect(env.host.open(id).state).toBe('idle'))
    expect((await env.host.accounts('codex')).current).toBe(list.accounts[1].id)
    expect(env.sends.map(s => s.session)).toEqual([1, 2])
    const notice = env.host.open(id).items.find(i => i.kind === 'notice' && i.id.startsWith('account-switch-'))
    expect(notice && notice.kind === 'notice' && notice.text).toMatch(/work@example\.com/)
    // 提示条的字段：界面按它拼文字、给「换回去」「关闭自动切换」
    expect(notice && notice.kind === 'notice' && notice.account).toEqual({
      engine: 'codex',
      from: 'default',
      to: list.accounts[1].id,
      fromName: 'me@example.com',
      toName: 'work@example.com',
      window: null,
      resetsAt: null,
    })
    expect(env.host.open(id).queue).toEqual([])
  })

  it('Claude 会话也一样：额度事件里的恢复时间带进提示条；到了恢复时间、下一轮结束时换回原账号', async () => {
    let resetsAt = 0
    const env = setup({
      engine: 'claude',
      limited: n => n === 1,
      resetsAt: () => (resetsAt = Date.now() + 30),
    })
    const list = await env.addAccount('work@example.com')
    env.host.setAccountAuto('claude', { enabled: true })
    const id = await send(env)
    await vi.waitFor(() => expect(env.sends).toHaveLength(2))
    await vi.waitFor(() => expect(env.host.open(id).state).toBe('idle'))
    const notice = env.host.open(id).items.find(i => i.kind === 'notice' && i.id.startsWith('account-switch-'))
    expect(notice && notice.kind === 'notice' && notice.account).toMatchObject({
      engine: 'claude',
      to: list.accounts[1].id,
      window: 'five_hour',
      resetsAt,
    })
    // 换到的账号上再聊一轮：这时已过恢复时间，结束后去看原账号，恢复了就换回去
    await new Promise(r => setTimeout(r, 40))
    await env.host.send(id, '接着改')
    await vi.waitFor(async () => expect((await env.host.accounts('claude')).current).toBe('default'))
    await vi.waitFor(() => expect(env.host.open(id).state).toBe('idle'))
    await vi.waitFor(() => expect(env.host.open(id).queue).toEqual([]))
  })

  it('重连次数设成 0（关闭）：换了账号的那条照样重新发送', async () => {
    const env = setup({ limited: n => n === 1 })
    await env.addAccount('work@example.com')
    env.host.setRetrySettings(0)
    env.host.setAccountAuto('codex', { enabled: true })
    const id = await send(env)
    await vi.waitFor(() => expect(env.sends).toHaveLength(2))
    await vi.waitFor(() => expect(env.host.open(id).state).toBe('idle'))
    expect(env.host.open(id).queue).toEqual([])
  })

  it('所有账号都用完：只换一次，第二次照常失败', async () => {
    const env = setup({ limited: () => true })
    await env.addAccount('work@example.com')
    env.host.setAccountAuto('codex', { enabled: true })
    const id = await send(env)
    await vi.waitFor(() => expect(env.host.open(id).queue[0]?.status).toBe('failed'))
    expect(env.sends).toHaveLength(2)
  })
})
