// 环境变量里的接口地址和 Key 一键迁到自定义 API（docs/ui/custom-api.md §3.4）：
// 建一个接口（Key 交给主进程加密保存），从环境变量里删掉这几项，全局默认原来是「自有」的改成这个接口
import { PROVIDER_ENV, type EngineConfigPatch, type EngineId } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { getPlatformState, setDefaultCustom } from '@/features/account/platform'
import { saveProvider } from '@/features/account/providers'
import type { ProviderInput, ProviderView } from '../../../../../shared/types/providers'

/** 环境变量里有哪些要迁的（变量名大小写不敏感，和引擎里的检查一致） */
export function providerEnvKeys(env: Record<string, string>): string[] {
  return Object.keys(env).filter(k => PROVIDER_ENV.includes(k.toUpperCase()))
}

/** 按引擎从环境变量拼出接口：Claude 的 ANTHROPIC_* 建成 Anthropic 协议，Codex 的 OPENAI_* 建成 Responses */
export function providerFromEnv(engine: EngineId, env: Record<string, string>): ProviderInput | null {
  const get = (name: string): string | undefined =>
    Object.entries(env)
      .find(([k]) => k.toUpperCase() === name)?.[1]
      ?.trim() || undefined
  if (engine === 'codex') {
    const key = get('OPENAI_API_KEY'),
      base = get('OPENAI_BASE_URL')
    if (!key && !base) return null
    return {
      name: tr('customApi.envMigratedName', { p0: 'Codex' }),
      template: base ? 'custom' : 'openai',
      protocol: 'responses',
      baseUrl: base ?? 'https://api.openai.com/v1',
      auth: 'bearer',
      ...(key ? { apiKey: key } : {}),
    }
  }
  const apiKey = get('ANTHROPIC_API_KEY'),
    token = get('ANTHROPIC_AUTH_TOKEN'),
    base = get('ANTHROPIC_BASE_URL')
  if (!apiKey && !token && !base) return null
  return {
    name: tr('customApi.envMigratedName', { p0: 'Claude Code' }),
    template: base ? 'custom' : 'anthropic',
    protocol: 'anthropic',
    baseUrl: base ?? 'https://api.anthropic.com',
    // ANTHROPIC_AUTH_TOKEN 在 Claude Code 里是 Bearer 认证
    auth: apiKey ? 'x-api-key' : 'bearer',
    ...(apiKey || token ? { apiKey: apiKey ?? token } : {}),
  }
}

export async function migrateEnv(
  engine: EngineId,
  env: Record<string, string>,
  saveConfig: (patch: EngineConfigPatch) => Promise<void>,
): Promise<ProviderView | null> {
  const input = providerFromEnv(engine, env)
  const keys = providerEnvKeys(env)
  if (!input && keys.length === 0) return null
  const view = input ? await saveProvider(input) : null
  const rest = Object.fromEntries(Object.entries(env).filter(([k]) => !keys.includes(k)))
  await saveConfig({ env: rest })
  if (view && getPlatformState(engine).source === 'self') setDefaultCustom(view.id, null, engine)
  return view
}
