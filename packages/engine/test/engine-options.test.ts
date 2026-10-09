// 设置 › 本机引擎 › 详情（docs/ui/engine-settings-redesign.md）：按引擎的新会话默认值、引擎级选项传给 Claude Code、改了下一条消息前重启进程
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostEvent } from '@pixelsky/protocol'
import { ClaudeAdapter, EngineHost } from '../src'

const FAKE = fileURLToPath(new URL('./fakes/fake-claude.mjs', import.meta.url))

let root: string
let events: HostEvent[]
let hosts: EngineHost[]

function makeHost(): EngineHost {
  const projectsDir = join(root, 'claude-projects')
  let host: EngineHost | null = null
  const adapter = new ClaudeAdapter({
    launcher: { command: process.execPath, args: [FAKE] },
    projectsDir,
    launchOptions: () => host!.launchOptions('claude'),
    env: {
      ...process.env,
      FAKE_CLAUDE_PROJECTS: projectsDir,
      FAKE_CLAUDE_LOG: join(root, 'argv.log'),
      FAKE_CLAUDE_ENV_LOG: join(root, 'env.json'),
    },
  })
  host = new EngineHost({ dataDir: join(root, 'data'), emit: e => events.push(e), adapters: { claude: adapter } })
  hosts.push(host)
  return host
}

function spawnArgs(): string[][] {
  try {
    return readFileSync(join(root, 'argv.log'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as string[])
  } catch {
    return []
  }
}

const envLog = (): { autoCompact?: string } => JSON.parse(readFileSync(join(root, 'env.json'), 'utf8'))

async function waitFor<T>(pick: () => T | undefined | null | false, timeoutMs = 10_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = pick()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error('等待超时')
    await new Promise(r => setTimeout(r, 20))
  }
}

const turnsDone = (id: string): number =>
  events.filter(e => e.kind === 'session' && e.sessionId === id && e.event.type === 'turn_completed').length

function project(host: EngineHost) {
  return host.addProject(mkdtempSync(join(root, 'proj-')))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-engine-options-'))
  events = []
  hosts = []
})

afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  rmSync(root, { recursive: true, force: true })
})

describe('本机引擎详情设置', () => {
  it('旧版的全局默认值迁移到每个引擎名下', () => {
    mkdirSync(join(root, 'data'), { recursive: true })
    writeFileSync(
      join(root, 'data', 'engine-settings.json'),
      JSON.stringify({
        version: 1,
        defaults: {
          engine: 'claude',
          model: 'opus',
          effort: 'low',
          permissionMode: 'plan',
          ultracode: false,
          fast: true,
          thinkingSummaries: false,
        },
      }),
    )
    const host = makeHost()
    expect(host.engineConfig().claude.defaults).toEqual({
      model: 'opus',
      effort: 'low',
      permissionMode: 'plan',
      ultracode: false,
      fast: true,
      thinkingSummaries: false,
    })
    expect(host.defaults()).toMatchObject({ engine: 'claude', effort: 'low', permissionMode: 'plan' })
  })

  it('新会话默认值改了立刻用于新会话；会话里改的选择记到所属引擎名下', async () => {
    const host = makeHost()
    const p = project(host)
    await host.setEngineConfig('claude', { defaults: { effort: 'max', permissionMode: 'full' } })
    const a = host.createSession({ projectId: p.id })
    expect(a).toMatchObject({ engine: 'claude', effort: 'max', permissionMode: 'full' })
    await host.update(a.id, { effort: 'low' })
    expect(host.engineConfig().claude.defaults.effort).toBe('low')
    expect(host.defaults()).toMatchObject({ engine: 'claude', effort: 'low', permissionMode: 'full' })
    await expect(host.setEngineConfig('claude', { defaults: { effort: 'huge' as never } })).rejects.toThrow(
      '默认推理强度不对',
    )
    await expect(host.setEngineConfig('claude', { defaults: { permissionMode: 'yolo' as never } })).rejects.toThrow(
      '默认权限不对',
    )
  })

  it('引擎级选项传给 Claude Code：输出风格、禁用提问、压缩触发点', async () => {
    const host = makeHost()
    await host.setEngineConfig('claude', { outputStyle: 'Explanatory', askQuestions: false, autoCompactPct: 70 })
    expect(host.engineConfig().claude).toMatchObject({
      outputStyle: 'Explanatory',
      askQuestions: false,
      autoCompactPct: 70,
    })
    const s = host.createSession({ projectId: project(host).id })
    await host.send(s.id, '你好')
    await waitFor(() => turnsDone(s.id) === 1)
    const args = spawnArgs().at(-1)!
    expect(args.join(' ')).toContain('--disallowedTools AskUserQuestion')
    const settings = args[args.indexOf('--settings') + 1]
    expect(JSON.parse(settings)).toMatchObject({ outputStyle: 'Explanatory' })
    expect(envLog().autoCompact).toBe('70')
    await expect(host.setEngineConfig('claude', { autoCompactPct: 33 })).rejects.toThrow('自动压缩触发点不对')
  })

  it('默认不加任何参数：允许提问、跟随 Claude Code 的输出风格和压缩阈值', async () => {
    const host = makeHost()
    expect(host.engineConfig().claude).toMatchObject({
      outputStyle: null,
      askQuestions: true,
      autoCompactPct: null,
      hidden: false,
    })
    const s = host.createSession({ projectId: project(host).id })
    await host.send(s.id, '你好')
    await waitFor(() => turnsDone(s.id) === 1)
    const args = spawnArgs().at(-1)!
    expect(args).not.toContain('--disallowedTools')
    expect(args).not.toContain('--settings')
    expect(envLog().autoCompact).toBeUndefined()
  })

  it('改了引擎级选项，已开始的会话在下一条消息前重启进程并接上原对话', async () => {
    const host = makeHost()
    const s = host.createSession({ projectId: project(host).id })
    await host.send(s.id, '第一条')
    await waitFor(() => turnsDone(s.id) === 1)
    await host.send(s.id, '第二条')
    await waitFor(() => turnsDone(s.id) === 2)
    expect(spawnArgs()).toHaveLength(1)

    await host.setEngineConfig('claude', { autoCompactPct: 80 })
    await host.send(s.id, '第三条')
    await waitFor(() => turnsDone(s.id) === 3)
    expect(spawnArgs()).toHaveLength(2)
    expect(spawnArgs().at(-1)).toContain('--resume')
    expect(envLog().autoCompact).toBe('80')

    // 只改新会话默认值、压缩模型不用重启
    await host.setEngineConfig('claude', { defaults: { effort: 'low' }, compactModel: 'claude-haiku-4-5' })
    await host.send(s.id, '第四条')
    await waitFor(() => turnsDone(s.id) === 4)
    expect(spawnArgs()).toHaveLength(2)
  })

  it('默认引擎不能隐藏；不支持的引擎不能设为默认；改了会广播', async () => {
    const host = makeHost()
    await expect(host.setEngineConfig('claude', { hidden: true })).rejects.toThrow('默认引擎不能隐藏')
    expect(() => host.setDefaultEngine('codex')).toThrow('这个引擎暂不支持')
    await host.setEngineConfig('claude', { askQuestions: false })
    expect(events.some(e => e.kind === 'engine_config' && e.config.claude.askQuestions === false)).toBe(true)
  })

  it('输出风格列表从 Claude Code 的初始化握手里读（不发消息）', async () => {
    const host = makeHost()
    const catalog = await host.engineCatalog('claude')
    expect(catalog).toMatchObject({
      outputStyles: ['default', 'Explanatory', 'Learning'],
      currentOutputStyle: 'default',
    })
    expect(catalog.models?.map(m => m.id)).toEqual(['opus', 'haiku'])
    expect(await host.engineCatalog('codex')).toEqual({ outputStyles: [], currentOutputStyle: null })
  })
})
