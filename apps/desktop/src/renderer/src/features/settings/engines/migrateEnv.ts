// 环境变量里的接口地址和 Key 一键迁到自定义 API（docs/ui/custom-api.md §3.4）：
// 每个厂商建一个接口（Key 交给主进程加密保存），从环境变量里删掉迁走了的那几项，全局默认原来是「自有」的改成这个引擎能用的接口
import { ENGINES, PROVIDER_ENV, type EngineConfigPatch, type EngineId } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { getPlatformState, setDefaultCustom } from '@/features/account/platform'
import { saveProvider } from '@/features/account/providers'
import type { ProviderInput, ProviderView } from '../../../../../shared/types/providers'

type Vendor = 'anthropic' | 'openai'

/** 每个厂商的变量（和 PROVIDER_ENV 一致） */
const VENDOR_ENV: Record<Vendor, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
  openai: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
}
const VENDOR_LABEL: Record<Vendor, string> = { anthropic: 'Anthropic', openai: 'OpenAI' }

/** 引擎自己用的厂商排第一（新接口里第一个是它能用的）；Claude Code 只认 ANTHROPIC_*、Codex 只认 OPENAI_*，像素星空两种都认 */
const vendorsFor = (engine: EngineId): Vendor[] =>
  engine === 'codex' ? ['openai', 'anthropic'] : ['anthropic', 'openai']

/** 环境变量里有哪些要迁的（变量名大小写不敏感，和引擎里的检查一致） */
export function providerEnvKeys(env: Record<string, string>): string[] {
  return Object.keys(env).filter(k => PROVIDER_ENV.includes(k.toUpperCase()))
}

export interface EnvMigration {
  vendor: Vendor
  input: ProviderInput
  /** 迁走后从环境变量里删掉的（原样的变量名） */
  keys: string[]
}

/**
 * 按厂商从环境变量拼出接口：ANTHROPIC_* 建成 Anthropic 协议，OPENAI_* 建成 OpenAI Responses（像素星空 / Codex 用 OPENAI_* 时就是这个协议）。
 * 只有一个、又是引擎自己的厂商时叫「<引擎> 环境变量」，否则后面带上厂商名；值是空的变量没东西可迁，跟着一起删
 */
export function providersFromEnv(engine: EngineId, env: Record<string, string>): EnvMigration[] {
  const keysOf = (vendor: Vendor): string[] =>
    Object.keys(env).filter(k => VENDOR_ENV[vendor].includes(k.toUpperCase()))
  const get = (name: string): string | undefined =>
    Object.entries(env)
      .find(([k]) => k.toUpperCase() === name)?.[1]
      ?.trim() || undefined
  const found: Array<{ vendor: Vendor; input: Omit<ProviderInput, 'name'> }> = []
  for (const vendor of vendorsFor(engine)) {
    if (vendor === 'openai') {
      const key = get('OPENAI_API_KEY'),
        base = get('OPENAI_BASE_URL')
      if (!key && !base) continue
      found.push({
        vendor,
        input: {
          template: base ? 'custom' : 'openai',
          protocol: 'responses',
          baseUrl: base ?? 'https://api.openai.com/v1',
          auth: 'bearer',
          ...(key ? { apiKey: key } : {}),
        },
      })
    } else {
      const apiKey = get('ANTHROPIC_API_KEY'),
        token = get('ANTHROPIC_AUTH_TOKEN'),
        base = get('ANTHROPIC_BASE_URL')
      if (!apiKey && !token && !base) continue
      found.push({
        vendor,
        input: {
          template: base ? 'custom' : 'anthropic',
          protocol: 'anthropic',
          baseUrl: base ?? 'https://api.anthropic.com',
          // ANTHROPIC_AUTH_TOKEN 在 Claude Code 里是 Bearer 认证
          auth: apiKey ? 'x-api-key' : 'bearer',
          ...(apiKey || token ? { apiKey: apiKey ?? token } : {}),
        },
      })
    }
  }
  const native: Vendor | null = engine === 'claude' ? 'anthropic' : engine === 'codex' ? 'openai' : null
  const plain = found.length === 1 && found[0].vendor === native
  return found.map(({ vendor, input }) => ({
    vendor,
    input: {
      name: plain
        ? tr('customApi.envMigratedName', { p0: ENGINES[engine].name })
        : tr('customApi.envMigratedNameVendor', { p0: ENGINES[engine].name, p1: VENDOR_LABEL[vendor] }),
      ...input,
    },
    keys: keysOf(vendor),
  }))
}

/**
 * 迁移：每个厂商一个接口，只删真迁走了的变量（建接口失败的那一批留在环境变量里，Key 不会丢）；值为空的变量一起删。
 * 返回建好的接口（name 是它们的名字连在一起，给设置页那句「已迁到…」用）；什么都没迁时为 null
 */
export async function migrateEnv(
  engine: EngineId,
  env: Record<string, string>,
  saveConfig: (patch: EngineConfigPatch) => Promise<void>,
): Promise<{ name: string; providers: ProviderView[] } | null> {
  const plans = providersFromEnv(engine, env)
  const blank = providerEnvKeys(env).filter(k => !env[k]?.trim())
  if (plans.length === 0 && blank.length === 0) return null
  const views: ProviderView[] = []
  const removed = new Set(blank)
  let failure: unknown = null
  for (const plan of plans) {
    try {
      views.push(await saveProvider(plan.input))
      for (const k of plan.keys) removed.add(k)
    } catch (e) {
      failure ??= e
    }
  }
  if (removed.size > 0)
    await saveConfig({ env: Object.fromEntries(Object.entries(env).filter(([k]) => !removed.has(k))) })
  // 默认来源原来是「自有」的改成新接口：只挑这个引擎能跑的协议（Claude Code 跑 Anthropic、Codex 跑 Responses）
  const usable = views.find(v =>
    engine === 'claude' ? v.protocol === 'anthropic' : engine === 'codex' ? v.protocol === 'responses' : true,
  )
  if (usable && getPlatformState(engine).source === 'self') setDefaultCustom(usable.id, null, engine)
  if (failure && views.length === 0) throw failure
  return views.length ? { name: views.map(v => v.name).join(' / '), providers: views } : null
}
