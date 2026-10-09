import { randomBytes } from 'node:crypto'
import { platformGateway } from './platformGateway'
import { once } from 'node:events'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import type { SessionRecord } from '@pixelsky/protocol'
import { CLAUDE_COMPACT_MARKER, rewriteCompaction } from '@pixelsky/engine'
import type { PlatformGroupInfo } from '../preload/platform-catalog'
import { platformFetch, signedInEmail, trustedSender } from './account'

async function jsonRequest(path: string, method = 'GET'): Promise<unknown> {
  const res = await platformFetch(path, { method, signal: AbortSignal.timeout(30_000) })
  const body = (await res.json()) as { data?: unknown; error?: unknown }
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : '平台服务暂时不可用，请刷新重试')
  return body.data
}

export async function platformGroups(): Promise<PlatformGroupInfo[]> {
  const data = await jsonRequest('/v1/platform/groups')
  if (!Array.isArray(data)) throw new Error('平台分组数据格式异常')
  return data.filter(
    (g): g is PlatformGroupInfo =>
      !!g &&
      typeof g.id === 'string' &&
      /^\d+$/.test(g.id) &&
      typeof g.name === 'string' &&
      typeof g.rate_multiplier === 'number' &&
      Number.isFinite(g.rate_multiplier) &&
      g.rate_multiplier >= 0 &&
      Array.isArray(g.models) &&
      g.models.every((m: unknown) => typeof m === 'string'),
  )
}

/** 排队任务执行前核对身份、当前目录权限与模型；实际请求还会重新检查。 */
export async function validateQueuedInput(record: SessionRecord): Promise<void> {
  const p = record.platform
  if (!p) return
  if (signedInEmail() !== p.account) throw new Error('平台账号已退出或切换，请登录原账号后重试')
  const groups = await platformGroups()
  const group = groups.find(g => g.id === p.groupId)
  if (!group) throw new Error('排队消息的线路已不可用，请撤回后重新选择')
  const engines = group.supported_engines ?? (group.platform === 'openai' ? ['codex'] : ['claude'])
  if (!engines.includes(record.engine)) throw new Error('线路协议与当前引擎不兼容')
  const models = group.models.length
    ? group.models
    : await jsonRequest(`/v1/platform/groups/${p.groupId}/models`, 'POST')
  if (record.model && (!Array.isArray(models) || !models.includes(record.model)))
    throw new Error('排队消息的模型已不可用，请撤回后重新选择')
}

/** 线路的模型列表，压缩换模型时核对用；缓存 5 分钟，读不到当作空（不换模型） */
const routeModelCache = new Map<string, { at: number; models: Promise<string[]> }>()
function routeModels(groupId: string): Promise<string[]> {
  const hit = routeModelCache.get(groupId)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.models
  const models = jsonRequest(`/v1/platform/groups/${groupId}/models`, 'POST')
    .then(d => (Array.isArray(d) ? d.filter((m): m is string => typeof m === 'string') : []))
    .catch(() => [] as string[])
  routeModelCache.set(groupId, { at: Date.now(), models })
  return models
}

/**
 * 平台代理。引擎只拿到本机短期凭据；账号访问令牌留在主进程。getRecord 读会话的当前记录：每个请求都按当前记录取分组和账号，
 * 所以会话中途换分组下一个请求就生效；会话改回自有后，旧进程的请求一律拒绝（docs/ui/source-switch.md §3.4）。
 */
export async function initPlatform(
  getRecord: (id: string) => SessionRecord | null | Promise<SessionRecord | null>,
  /** Claude Code 压缩上下文用的模型（设置 › 本机引擎）；null 表示跟随会话模型 */
  compactModel: () => string | null = () => null,
  requestContext?: (record: SessionRecord) => ((requestId: string, model: string) => void | Promise<void>) | undefined,
): Promise<(record: SessionRecord) => NodeJS.ProcessEnv> {
  ipcMain.handle('platform:groups', e => {
    if (!trustedSender(e)) throw new Error('不受信任的页面')
    return platformGroups()
  })
  ipcMain.handle('platform:models', async (e, id: unknown) => {
    if (!trustedSender(e) || typeof id !== 'string' || !/^\d+$/.test(id)) throw new Error('无效的分组')
    const data = await jsonRequest(`/v1/platform/groups/${id}/models`, 'POST')
    if (!Array.isArray(data) || !data.every(m => typeof m === 'string')) throw new Error('平台模型数据格式异常')
    return data
  })

  const sessions = new Map<string, { secret: string; recordId: string }>()
  const settingsFiles = new Set<string>()
  const server = platformGateway({
    sessions,
    record: getRecord,
    account: signedInEmail,
    fetch: platformFetch,
    requestContext,
    rewrite: async (body, groupId) => {
      const model = compactModel()
      return model && body.includes(CLAUDE_COMPACT_MARKER)
        ? (rewriteCompaction(body, model, await routeModels(groupId)) ?? body)
        : body
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  server.unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('平台代理启动失败')
  app.on('will-quit', () => {
    server.closeAllConnections()
    server.close()
    for (const file of settingsFiles) rmSync(file, { force: true })
  })
  return record => {
    if (!record.platform) return {}
    if (signedInEmail() !== record.platform.account) throw new Error('请登录此会话使用的平台账号')
    let entry = sessions.get(record.id)
    if (!entry) {
      entry = { recordId: record.id, secret: randomBytes(32).toString('hex') }
      sessions.set(record.id, entry)
    }
    if (record.engine === 'codex')
      return {
        PIXELSKY_CODEX_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        PIXELSKY_CODEX_TOKEN: entry.secret,
      }
    const env = {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      ANTHROPIC_AUTH_TOKEN: entry.secret,
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      CLAUDE_CODE_USE_BEDROCK: '0',
      CLAUDE_CODE_USE_VERTEX: '0',
      CLAUDE_CODE_USE_FOUNDRY: '0',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    // --settings 优先于本机已有的 settings.json，防止其中的 API 地址覆盖平台路由。
    const dir = join(app.getPath('userData'), 'gateway')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${randomBytes(12).toString('hex')}.json`)
    writeFileSync(file, JSON.stringify({ env }), { mode: 0o600 })
    settingsFiles.add(file)
    return { ...env, PIXELSKY_GATEWAY_SETTINGS: file }
  }
}
