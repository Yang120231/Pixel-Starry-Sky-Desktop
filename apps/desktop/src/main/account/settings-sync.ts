// 设置云同步的主进程部分（docs/ui/settings-sync.md §5.1）：读写云端的 /v1/oauth/settings，
// 以及引擎设置里可以同步的几项。同步规则、白名单在渲染进程（features/settings/sync/）。
// 只收发 desktop.* 键：旧版客户端写的 ui.*、engine.* 两个程序各管各的。
import type { AppContext } from '../app/context'
import * as ipc from '../ipc/guard'
import type { CloudSetting, CloudSettings } from '../../shared/types/settings-sync'
import { settingsFetch, signedInEmail } from './account'

/** 和云端的防护一致（services/cloud internal/settings）：键名、单个值大小、每个账号的键数 */
export const KEY_PATTERN = /^desktop\.[A-Za-z0-9._-]{1,92}$/
export const MAX_VALUE_BYTES = 64 * 1024
export const MAX_KEYS = 300
const ENGINE_KEYS = ['desktop.engine.defaults', 'desktop.engine.options', 'desktop.engine.retries'] as const

/** 只留 desktop.* 键和格式对的条目 */
export function parseCloudSettings(body: unknown): CloudSettings {
  const raw = (body as { settings?: unknown } | null)?.settings
  const out: CloudSettings = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_PATTERN.test(key) || !entry || typeof entry !== 'object') continue
    const { value, updated_at } = entry as { value?: unknown; updated_at?: unknown }
    if (typeof updated_at !== 'number' || !Number.isFinite(updated_at) || value === undefined) continue
    out[key] = { value, updatedAt: updated_at } satisfies CloudSetting
  }
  return out
}

/** 上传前的检查：键名、值能序列化且不超过 64 KB、一次不超过 300 个；null 表示删掉 */
export function checkChanges(changes: unknown): Record<string, unknown> {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('同步参数不对')
  const entries = Object.entries(changes as Record<string, unknown>)
  if (entries.length > MAX_KEYS) throw new Error('一次同步的设置太多')
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) throw new Error(`设置名不对：${key}`)
    const json = JSON.stringify(value)
    if (json === undefined) throw new Error(`设置 ${key} 的值不能同步`)
    if (Buffer.byteLength(json) > MAX_VALUE_BYTES) throw new Error(`设置 ${key} 太大`)
  }
  return Object.fromEntries(entries)
}

export async function readSettingsResponse(res: Response): Promise<CloudSettings> {
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(res.status >= 500 ? '云端服务暂时连不上，稍后自动重试' : `设置同步失败（${res.status}）`)
  }
  return parseCloudSettings(await res.json())
}

export function initSettingsSync(ctx: AppContext): void {
  const deny = { deny: '不允许的调用方' }
  // 返回的 account 用来按账号分开保存同步状态；没登录时不发请求
  ipc.handle(
    'settings:pull',
    async () => {
      const account = signedInEmail()
      if (!account) return { account: null, settings: {} }
      return { account, settings: await readSettingsResponse(await settingsFetch('GET')) }
    },
    deny,
  )
  ipc.handle(
    'settings:push',
    async (_event, changes: unknown) => {
      const account = signedInEmail()
      if (!account) throw new Error('请先登录像素星空账号')
      return {
        account,
        settings: await readSettingsResponse(await settingsFetch('PUT', { settings: checkChanges(changes) })),
      }
    },
    deny,
  )
  // 引擎设置只读写本机的（选中 SSH 机器时也是本机这一份，docs/ui/settings-sync.md §3）
  ipc.handle('settings:engine', () => ctx.engine?.syncableSettings() ?? null, deny)
  ipc.handle(
    'settings:applyEngine',
    async (_event, key: unknown, value: unknown) => {
      if (!ENGINE_KEYS.includes(key as (typeof ENGINE_KEYS)[number])) throw new Error('不是引擎设置')
      await ctx.engine?.applySyncableSetting(key as string, value)
      return ctx.engine?.syncableSettings() ?? null
    },
    deny,
  )
}
