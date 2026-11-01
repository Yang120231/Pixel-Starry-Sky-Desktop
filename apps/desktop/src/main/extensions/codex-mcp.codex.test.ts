// 经过真实 Codex 进程的回归：codexMcp() 生成的 -c 参数，Codex 要认得出服务名、起得来、列得出工具。
// 之前键写成 mcp_servers."pixelsky_channel"，Codex 读到的名字带引号，频道 MCP 起不来，task_done 等工具全没了。
// 本机找不到 codex 时跳过。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { codexExecutable, resolveCommand, tomlValue } from '@pixelsky/engine'
import type { SessionRecord } from '@pixelsky/protocol'
import type { Channels } from '../core/channels/service'
import { channelToolsServer, CHANNEL_SERVER_NAME, type ChannelToolsServer } from '../channels/channel-mcp'
import { codexMcp } from './service'

const found = resolveCommand(process.env.PIXELSKY_TEST_CODEX ?? 'codex')
const codex = found.ok ? found.path : 'path' in found ? codexExecutable(found.path) : null

const STDIO_SERVER = `
const { McpServer } = require(${JSON.stringify(createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/server/mcp.js'))})
const { StdioServerTransport } = require(${JSON.stringify(createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/server/stdio.js'))})
const s = new McpServer({ name: 'stdio-probe', version: '1' })
s.tool('ping', async () => ({ content: [{ type: 'text', text: process.env.PROBE_SECRET }] }))
s.connect(new StdioServerTransport())
`

let server: ChannelToolsServer | null = null,
  proc: ChildProcessWithoutNullStreams | null = null,
  dir: string | null = null
afterEach(async () => {
  const p = proc
  proc = null
  if (p && p.exitCode === null && p.signalCode === null) {
    const gone = new Promise(r => p.once('exit', r))
    p.kill()
    await gone
  }
  server?.close()
  server = null
  // Codex 在 Windows 上会改 CODEX_HOME 的权限，删不掉就留在临时目录里
  if (dir)
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* 尽力 */
    }
  dir = null
})

/** 起 codex app-server，轮询 mcpServerStatus/list 直到列出的服务都不再是启动中 */
async function codexServers(
  args: string[],
  env: Record<string, string>,
  names: string[],
): Promise<{ name: string; tools: string[]; status?: string; raw: unknown }[]> {
  proc = spawn(codex!, ['app-server', '--listen', 'stdio://', ...args], {
    env: { ...process.env, ...env, CODEX_HOME: join(dir!, 'home') },
    cwd: tmpdir(),
  })
  const pending = new Map<number, (m: Record<string, unknown>) => void>(),
    startup = new Map<string, string>()
  let id = 0
  createInterface({ input: proc.stdout }).on('line', line => {
    let m: Record<string, unknown>
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    if (typeof m.id === 'number' && pending.has(m.id)) pending.get(m.id)!(m)
    if (m.method === 'mcpServer/startupStatus/updated') {
      const p = m.params as { name?: string; status?: string }
      if (p.name) startup.set(p.name, p.status ?? '')
    }
  })
  let stderr = ''
  proc.stderr.on('data', d => (stderr += d))
  const exited = new Promise<never>((_, reject) =>
    proc!.on('exit', code => reject(new Error(`codex 退出了（${code}）：${stderr}`))),
  )
  const request = (method: string, params: unknown): Promise<Record<string, unknown>> =>
    Promise.race([
      exited,
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const n = ++id
        pending.set(n, m => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result as never)))
        proc!.stdin.write(JSON.stringify({ id: n, method, params }) + '\n')
        setTimeout(() => reject(new Error(`${method} 没有回应：${stderr}`)), 20_000).unref()
      }),
    ])
  exited.catch(() => {})
  await request('initialize', { clientInfo: { name: 'pixelsky-test', version: '0' } })
  proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
  const deadline = Date.now() + 40_000
  for (;;) {
    const r = await request('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' })
    const list = (r.data as Record<string, unknown>[]).map(s => ({
      name: String(s.name),
      tools: Object.values((s.tools ?? {}) as Record<string, { name?: string }>)
        .map(t => t.name ?? '')
        .sort(),
      status: s.toolsError ? 'failed' : startup.get(String(s.name)),
      raw: s,
    }))
    const settled = names.every(n => {
      const s = list.find(x => x.name === n)
      return s && (s.tools.length || s.status === 'failed')
    })
    if (settled || Date.now() > deadline) return list
    await new Promise(r => setTimeout(r, 300))
  }
}

describe.skipIf(!codex)('codexMcp 经真实 Codex 进程', () => {
  it('频道 HTTP 服务和 stdio 服务都起得来，频道的交付、提问工具都在', { timeout: 90_000 }, async () => {
    dir = mkdtempSync(join(tmpdir(), 'pixelsky-codex-mcp-'))
    writeFileSync(join(dir, 'probe.cjs'), STDIO_SERVER)
    mkdirSync(join(dir, 'home'))
    server = channelToolsServer(
      () =>
        ({
          sessionMember: (sid: string) => (sid === 's1' ? { memberId: 'm1', tools: null } : null),
        }) as unknown as Channels,
    )
    const own = await server.forSession({ id: 's1' } as SessionRecord)
    const { codexConfig, env } = codexMcp(
      {
        probe: { type: 'stdio', command: process.execPath, args: [join(dir, 'probe.cjs')], env: { PROBE_SECRET: 'x' } },
        [CHANNEL_SERVER_NAME]: {
          type: 'http',
          url: own!.entry!.url,
          headers: { Authorization: `Bearer ${own!.entry!.token}` },
        },
      },
      {},
    )
    const args = Object.entries(codexConfig).flatMap(([k, v]) => ['-c', `${k}=${tomlValue(v)}`])
    const list = await codexServers(args, env, [CHANNEL_SERVER_NAME, 'probe'])
    expect(list.map(s => s.name).sort()).toEqual([CHANNEL_SERVER_NAME, 'probe'])
    const channel = list.find(s => s.name === CHANNEL_SERVER_NAME)!
    expect(channel.status, JSON.stringify(channel.raw)).not.toBe('failed')
    expect(channel.tools).toEqual(expect.arrayContaining(['task_done', 'member_ask', 'user_ask', 'channel_reply']))
    expect(list.find(s => s.name === 'probe')!.tools).toEqual(['ping'])
  })
})
