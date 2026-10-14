// 模型通道（docs/ui/model-channels.md）：界面上只选「通道 + 模型」，谁来执行按规则定（§2.5）。
// 存储不变，还是「引擎 + 额度来源 + 模型 / 线路 / 接口」；这里只做两边的换算，全是纯函数。
import type { EngineId, EngineInfo } from '@pixelsky/protocol'
import type { ProviderProtocol, ProviderView } from '../../../../shared/types/providers'
import { platformModelSupportsEngine } from '../../../../shared/platform-models'
import {
  groupSupportsEngine,
  groupsForModel,
  platformModels,
  visibleModels,
  type CreditSource,
  type PlatformGroup,
} from '@/features/account/platform'

/** ① 像素星空账号、② Claude 授权、③ ChatGPT 授权、④ 自定义接口 */
export type ChannelId = 'platform' | 'claude' | 'chatgpt' | 'custom'
export const CHANNELS: readonly ChannelId[] = ['platform', 'claude', 'chatgpt', 'custom']

/** 授权通道只能交给官方工具（订阅 / 账号只给它们用） */
export const AUTH_ENGINE = { claude: 'claude', chatgpt: 'codex' } as const satisfies Record<string, EngineId>
export type AuthChannel = keyof typeof AUTH_ENGINE

export const isAuthChannel = (c: ChannelId): c is AuthChannel => c === 'claude' || c === 'chatgpt'

/** 现有的「引擎 + 额度来源」→ 通道；像素星空 + 自有没有对应的通道，按自定义算 */
export function channelOf(engine: EngineId, source: CreditSource): ChannelId {
  if (source === 'platform' || source === 'custom') return source
  return engine === 'claude' ? 'claude' : engine === 'codex' ? 'chatgpt' : 'custom'
}

export const sourceOfChannel = (c: ChannelId): CreditSource => (c === 'platform' || c === 'custom' ? c : 'self')

/** 菜单里的一个模型 */
export interface ModelTarget {
  channel: ChannelId
  /** 平台 / 自定义：完整模型名；授权通道：引擎的模型别名，null 跟随引擎默认 */
  model: string | null
  /** 自定义接口 id，其它通道为 null */
  providerId: string | null
}

/** 选定的模型 + 谁来执行 */
export interface ChannelChoice extends ModelTarget {
  engine: EngineId
}

export const sameTarget = (a: ModelTarget | null, b: ModelTarget | null): boolean =>
  !!a && !!b && a.channel === b.channel && a.model === b.model && (a.providerId ?? null) === (b.providerId ?? null)

/** 能跑这个协议的执行者，默认的排第一 */
export const protocolExecutors = (p: ProviderProtocol): EngineId[] =>
  p === 'anthropic' ? ['claude', 'pixel'] : p === 'responses' ? ['codex', 'pixel'] : ['pixel']

/** 官方工具排在像素星空前面 */
const ORDER: readonly EngineId[] = ['claude', 'codex', 'pixel']

/** 能跑这个模型的执行者，默认的排第一；平台同时核对模型协议和线路声明的引擎能力 */
export function executorsFor(
  target: ModelTarget,
  ctx: { groups: PlatformGroup[]; providers: Pick<ProviderView, 'id' | 'protocol'>[] },
): EngineId[] {
  if (target.channel === 'claude' || target.channel === 'chatgpt') return [AUTH_ENGINE[target.channel]]
  if (target.channel === 'custom') {
    const p = ctx.providers.find(x => x.id === target.providerId)
    return p ? protocolExecutors(p.protocol) : []
  }
  if (!target.model) return []
  const groups = groupsForModel(ctx.groups, target.model)
  return ORDER.filter(e => platformModelSupportsEngine(target.model, e) && groups.some(g => groupSupportsEngine(g, e)))
}

type EngineLite = Pick<EngineInfo, 'id' | 'status'>

/** 引擎能不能拿来执行：装好了能启动；平台和自定义接口不需要引擎自己登录 */
export function engineRunnable(info: EngineLite | undefined, channel: ChannelId): boolean {
  if (!info) return false
  if (info.status === 'ready') return true
  return info.status === 'unauthenticated' && (channel === 'platform' || channel === 'custom')
}

export interface ExecutorPick {
  /** 这次用谁；没有能跑的时为默认的那个（菜单灰掉这一行） */
  engine: EngineId | null
  /** 「谁来执行」里列的：能跑这个模型、也装好了的；只有一个时不能换 */
  options: EngineId[]
  /** 默认的执行者用不了，自动换成了 engine */
  fallbackFrom: EngineId | null
  /** 能跑的一个都没有 */
  unavailable: boolean
}

/**
 * 选谁来执行：记住的（还能跑的话）→ 默认的 → 下一个能跑的。
 * locked 是已开始对话的引擎：执行者固定，跑不了这个模型时 engine 为 null。
 */
export function pickExecutor(
  candidates: EngineId[],
  opts: { channel: ChannelId; engines: EngineLite[]; remembered?: EngineId | null; locked?: EngineId | null },
): ExecutorPick {
  if (opts.locked) {
    const ok = candidates.includes(opts.locked)
    return { engine: ok ? opts.locked : null, options: ok ? [opts.locked] : [], fallbackFrom: null, unavailable: !ok }
  }
  const options = candidates.filter(e =>
    engineRunnable(
      opts.engines.find(i => i.id === e),
      opts.channel,
    ),
  )
  const chosen = opts.remembered && options.includes(opts.remembered) ? opts.remembered : (options[0] ?? null)
  const first = candidates[0] ?? null
  return {
    engine: chosen ?? first,
    options,
    fallbackFrom: chosen && first && chosen !== first && !options.includes(first) ? first : null,
    unavailable: !chosen,
  }
}

// ---------------------------------------------------------------------------
// 通道状态（菜单分组的标题行和设置页的卡片共用）
// ---------------------------------------------------------------------------

export type ChannelState =
  | { kind: 'ready' }
  /** 引擎还没检测完 / 平台线路读取中 */
  | { kind: 'loading' }
  /** ① 没登录像素星空 */
  | { kind: 'signin' }
  /** ① 没有能用的线路 */
  | { kind: 'no-route' }
  /** ②③ 没授权 */
  | { kind: 'auth' }
  /** ②③ 引擎没装 */
  | { kind: 'missing' }
  /** ②③ 引擎版本太低 */
  | { kind: 'outdated'; message: string | null }
  /** ②③ 引擎不可用 */
  | { kind: 'error'; message: string | null }
  /** ④ 还没加接口 */
  | { kind: 'empty' }

export function channelState(
  channel: ChannelId,
  ctx: {
    platform: { email: string | null; loaded: boolean; loading: boolean; groups: PlatformGroup[] }
    engines: Array<Pick<EngineInfo, 'id' | 'status' | 'message'>>
    providers: unknown[]
  },
): ChannelState {
  if (channel === 'platform') {
    const p = ctx.platform
    if (!p.email) return { kind: 'signin' }
    if (!p.loaded) return { kind: 'loading' }
    return platformModels(p.groups).length > 0 ? { kind: 'ready' } : { kind: 'no-route' }
  }
  if (channel === 'custom') return ctx.providers.length > 0 ? { kind: 'ready' } : { kind: 'empty' }
  const info = ctx.engines.find(e => e.id === AUTH_ENGINE[channel])
  if (!info) return { kind: 'loading' }
  switch (info.status) {
    case 'ready':
      return { kind: 'ready' }
    case 'unauthenticated':
      return { kind: 'auth' }
    case 'missing':
      return { kind: 'missing' }
    case 'outdated':
      return { kind: 'outdated', message: info.message }
    default:
      return { kind: 'error', message: info.message }
  }
}

// ---------------------------------------------------------------------------
// 菜单（输入框和设置页共用）
// ---------------------------------------------------------------------------

/** 按模型记住的执行者：平台按模型名，自定义按接口（协议跟着接口定）；授权通道只有一个执行者，不记 */
export function executorKey(t: ModelTarget): string | null {
  if (t.channel === 'platform') return t.model ? `platform:${t.model}` : null
  if (t.channel === 'custom') return t.providerId ? `custom:${t.providerId}` : null
  return null
}

export interface ChannelRow {
  key: string
  target: ModelTarget
  /** 能跑这个模型的执行者（含没装的），默认的排第一 */
  candidates: EngineId[]
  pick: ExecutorPick
  selected: boolean
  /** 灰掉的原因：locked 对话已开始、换不了执行者；no-executor 能跑它的执行者都没装 */
  disabled: 'locked' | 'no-executor' | null
}

export interface ChannelGroupView {
  channel: ChannelId
  state: ChannelState
  rows: ChannelRow[]
}

export interface MenuInput {
  selection: ModelTarget | null
  /** 已开始的对话用的引擎（执行者固定）；新任务为 null */
  locked: EngineId | null
  platform: { email: string | null; loaded: boolean; loading: boolean; groups: PlatformGroup[]; hiddenModels: string[] }
  /** 授权通道列的模型（引擎的别名表 / 目录） */
  selfModels: Record<AuthChannel, Array<{ value: string | null }>>
  providers: Array<Pick<ProviderView, 'id' | 'protocol' | 'models'>>
  engines: Array<Pick<EngineInfo, 'id' | 'status' | 'message'>>
  remembered: Record<string, EngineId>
}

/** 四个分组和每一行；通道不能用时（没登录 / 没授权 / 没接口）那组没有行，界面写状态和按钮 */
export function buildChannelMenu(input: MenuInput): ChannelGroupView[] {
  const ctx = { groups: input.platform.groups, providers: input.providers }
  const row = (target: ModelTarget, key: string): ChannelRow => {
    const candidates = executorsFor(target, ctx)
    const memo = executorKey(target)
    const pick = pickExecutor(candidates, {
      channel: target.channel,
      engines: input.engines,
      remembered: memo ? input.remembered[memo] : null,
      locked: input.locked,
    })
    return {
      key,
      target,
      candidates,
      pick,
      selected: sameTarget(target, input.selection),
      disabled: input.locked && !pick.engine ? 'locked' : pick.unavailable ? 'no-executor' : null,
    }
  }
  return CHANNELS.map(channel => {
    const state = channelState(channel, {
      platform: input.platform,
      engines: input.engines,
      providers: input.providers,
    })
    if (state.kind !== 'ready') return { channel, state, rows: [] }
    let rows: ChannelRow[]
    if (channel === 'platform') {
      const all = platformModels(input.platform.groups)
      const keep = input.selection?.channel === 'platform' ? [input.selection.model] : []
      rows = visibleModels(all, input.platform.hiddenModels, keep).map(m =>
        row({ channel, model: m, providerId: null }, `platform:${m}`),
      )
    } else if (channel === 'custom') {
      rows = input.providers.map(p => {
        const current = input.selection?.channel === 'custom' && input.selection.providerId === p.id
        const model = current ? input.selection!.model : (p.models[0]?.id ?? null)
        const r = row({ channel, model, providerId: p.id }, `custom:${p.id}`)
        // 接口这一行代表整个接口：选中的是它的哪个模型都算选中
        return { ...r, selected: current }
      })
    } else {
      rows = input.selfModels[channel].map(m =>
        row({ channel, model: m.value, providerId: null }, `${channel}:${m.value ?? ''}`),
      )
    }
    return { channel, state, rows }
  })
}

// ---------------------------------------------------------------------------
// 本机存储：按模型记住的执行者、新任务用什么（§2.5、§2.6）
// ---------------------------------------------------------------------------

export const EXECUTOR_KEY = 'pixelsky.channels.executor.v1'
export const NEW_TASK_KEY = 'pixelsky.channels.newTask.v1'

const ENGINE_IDS: readonly EngineId[] = ['claude', 'codex', 'pixel']
const isEngine = (v: unknown): v is EngineId => typeof v === 'string' && (ENGINE_IDS as string[]).includes(v)

export function parseExecutorMemory(raw: string | null): Record<string, EngineId> {
  try {
    const o = JSON.parse(raw ?? '{}') as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    return Object.fromEntries(Object.entries(o).filter((e): e is [string, EngineId] => isEngine(e[1])))
  } catch {
    return {}
  }
}

/** 新任务默认：接着上次（默认），或固定为某个模型 */
export type NewTaskDefault = { mode: 'last' } | { mode: 'fixed'; choice: ChannelChoice }

export function parseNewTask(raw: string | null): NewTaskDefault {
  try {
    const o = JSON.parse(raw ?? 'null') as Record<string, unknown> | null
    const c = o?.choice as Record<string, unknown> | undefined
    if (o?.mode !== 'fixed' || !c || !(CHANNELS as unknown[]).includes(c.channel) || !isEngine(c.engine))
      return { mode: 'last' }
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    return {
      mode: 'fixed',
      choice: {
        channel: c.channel as ChannelId,
        model: str(c.model),
        providerId: str(c.providerId),
        engine: c.engine,
      },
    }
  } catch {
    return { mode: 'last' }
  }
}
