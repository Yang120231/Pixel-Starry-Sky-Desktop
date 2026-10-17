// 「终端里有原来的 AI 会话，点一下接着聊」的提示：查询、缓存、并发限制、文案（纯函数）。
// 导入项目之后（设置 › 项目的结果行、别的入口的提示条）和项目里还没有对话时的空状态共用同一份结果。
import { useEffect, useSyncExternalStore } from 'react'
import type { EngineConfig, NativeSessionSummary } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { getEngineState, listNativeSessions, subscribeEngine } from '@/features/engine/store'
import { getMachines, machineOf } from '@/features/machines/store'
import { openResumePicker } from './store'

export type HintEngine = 'claude' | 'codex'
export type ResumeCounts = Partial<Record<HintEngine, number>>

/** 会去查、也能打开选择器的引擎 */
export const HINT_ENGINES: readonly HintEngine[] = ['claude', 'codex']
/** 同时最多几个查询在跑（所有项目、所有引擎加起来） */
export const HINT_CONCURRENCY = 4
/** 一次导入最多查前多少个项目 */
export const HINT_MAX_PROJECTS = 40
const TTL_MS = 60_000

/** 文案键和参数；没有会话（全是 0 或没有）为 null */
export type HintKey = 'resume.hint.claude' | 'resume.hint.codex' | 'resume.hint.both'
export function hintMessage(counts: ResumeCounts): { key: HintKey; params: Record<string, number> } | null {
  const claude = counts.claude ?? 0
  const codex = counts.codex ?? 0
  if (claude > 0 && codex > 0) return { key: 'resume.hint.both', params: { claude, codex } }
  if (claude > 0) return { key: 'resume.hint.claude', params: { n: claude } }
  if (codex > 0) return { key: 'resume.hint.codex', params: { n: codex } }
  return null
}

export function hintText(counts: ResumeCounts): string | null {
  const m = hintMessage(counts)
  return m ? tr(m.key, m.params) : null
}

/**
 * 点「接着聊」打开哪个引擎的选择器：只有一个引擎有会话就那一个；两个都有，先开当前执行者那个，
 * 执行者两个都不是（或不知道）就开会话多的，一样多先 Claude Code
 */
export function hintEngine(counts: ResumeCounts, executor?: string | null): HintEngine {
  const claude = counts.claude ?? 0
  const codex = counts.codex ?? 0
  if (claude > 0 && codex > 0) {
    if (executor === 'claude' || executor === 'codex') return executor
    return codex > claude ? 'codex' : 'claude'
  }
  return codex > 0 ? 'codex' : 'claude'
}

/** 终端里的会话：没被像素星空对话占用的才算「可以接着聊」 */
export const resumableCount = (list: readonly NativeSessionSummary[]): number =>
  list.filter(s => s.ownerId === null).length

/** 限制并发的 map：同时最多 limit 个 fn 在跑，结果按原顺序 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** 全局的查询并发闸：多个项目 × 多个引擎同时查时，在跑的查询也不超过 HINT_CONCURRENCY 个 */
let inFlight = 0
const waiters: Array<() => void> = []
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= HINT_CONCURRENCY) await new Promise<void>(resolve => waiters.push(resolve))
  else inFlight++
  try {
    return await fn()
  } finally {
    // 把名额直接交给下一个等着的；没人等才归还
    const next = waiters.shift()
    if (next) next()
    else inFlight--
  }
}

type Lister = (projectId: string, engine: HintEngine) => Promise<readonly NativeSessionSummary[]>
const defaultLister: Lister = (projectId, engine) => listNativeSessions(projectId, { engine, subfolders: true })

/**
 * 查一个项目的会话数。两个引擎同时查（不比只查一个慢），在跑的查询总数由 withSlot 限制。
 * 远程机器 / WSL 项目、查询失败（比如 Codex 没装）、引擎不支持都按「没有」处理，不抛错
 */
export async function fetchResumeCounts(
  projectId: string,
  list: Lister = defaultLister,
  engines: readonly HintEngine[] = HINT_ENGINES,
): Promise<ResumeCounts> {
  if (machineOf(projectId) !== 'local') return {}
  const counts: ResumeCounts = {}
  await Promise.all(
    engines.map(async engine => {
      try {
        const n = resumableCount(await withSlot(() => list(projectId, engine)))
        if (n > 0) counts[engine] = n
      } catch {
        /* 当作没有 */
      }
    }),
  )
  // 按引擎顺序放回去，不让谁先查完影响对象的键顺序
  return Object.fromEntries(engines.flatMap(e => (counts[e] ? [[e, counts[e]]] : []))) as ResumeCounts
}

// ---------- 缓存（按项目；一分钟内不重查；引擎的启动配置变了就作废） ----------
interface Entry {
  counts: ResumeCounts | null
  at: number
  pending: Promise<void> | null
  /** 按哪一代启动配置查的：代变了，结果作废、要重查 */
  generation: number
}
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(l => l())
let lister: Lister = defaultLister
/** 启动配置的代：设置里改了 CODEX_HOME / CLAUDE_CONFIG_DIR 等环境变量、程序或参数时加一 */
let generation = 0
let launchSeen: { config: EngineConfig | null; key: string } | null = null
let watching = false

/** 测试用 */
export function resetResumeHints(next: Lister = defaultLister): void {
  cache.clear()
  lister = next
  launchSeen = null
  emit()
}

/** 会影响「会话从哪个目录读」的配置：程序、参数、环境变量 */
function launchKey(config: EngineConfig): string {
  return JSON.stringify(
    HINT_ENGINES.map(engine => {
      const c = config[engine]
      if (!c) return null
      const env = Object.entries(c.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return [c.path, c.args, env]
    }),
  )
}

/**
 * 引擎配置更新时调（engine_config 广播后 store 会变）：启动配置变了，所有项目的计数作废、在后台重查
 * （查询并发仍由 withSlot 限制）；重查完之前先显示旧的数字。第一次拿到配置不算变
 */
export function noteEngineConfig(config: EngineConfig | null): void {
  if (!config || launchSeen?.config === config) return
  const key = launchKey(config)
  const changed = launchSeen !== null && launchSeen.key !== key
  launchSeen = { config, key }
  if (!changed) return
  generation++
  for (const id of [...cache.keys()]) void ensureResumeCounts(id)
}

/** 当前机器不是本机时 store 里的配置（远程机器的）：计数只查本机项目，这些配置不算数 */
const foreignConfigs = new WeakSet<EngineConfig>()

/**
 * store 变了：只认本机的引擎配置。切机器时 currentId 先变、配置后到，
 * 中间看到的远程配置之前已经记进 foreignConfigs，不会被当成本机配置变了
 */
function onEngineChange(): void {
  const config = getEngineState().config
  if (!config) return
  if (getMachines().currentId !== 'local') {
    foreignConfigs.add(config)
    return
  }
  if (!foreignConfigs.has(config)) noteEngineConfig(config)
}

/** 第一次查询时开始跟着引擎配置（只订阅一次） */
function watchEngineConfig(): void {
  if (watching) return
  watching = true
  onEngineChange()
  subscribeEngine(onEngineChange)
}

export function cachedResumeCounts(projectId: string): ResumeCounts | null {
  return cache.get(projectId)?.counts ?? null
}

/** 查一个项目（有新鲜缓存或正在查就不再查） */
export function ensureResumeCounts(projectId: string): Promise<void> {
  watchEngineConfig()
  const hit = cache.get(projectId)
  const current = hit?.generation === generation
  if (hit?.pending && current) return hit.pending
  if (hit?.counts && current && Date.now() - hit.at < TTL_MS) return Promise.resolve()
  const entry: Entry = { counts: hit?.counts ?? null, at: hit?.at ?? 0, pending: null, generation }
  entry.pending = fetchResumeCounts(projectId, lister).then(counts => {
    // 查的途中配置又变了（已经有新的一次在查）或缓存被清了：这次的结果不要，等着的人改等新的那次
    const latest = cache.get(projectId)
    if (latest !== entry) return latest?.pending ?? undefined
    entry.counts = counts
    entry.at = Date.now()
    entry.pending = null
    emit()
  })
  cache.set(projectId, entry)
  return entry.pending
}

/** 一批项目：限制并发、只查前 HINT_MAX_PROJECTS 个；返回有会话的项目 id → 会话数 */
export async function prefetchResumeCounts(
  projectIds: readonly string[],
  limit = HINT_CONCURRENCY,
): Promise<Map<string, ResumeCounts>> {
  const ids = [...new Set(projectIds)].slice(0, HINT_MAX_PROJECTS)
  await mapLimit(ids, limit, ensureResumeCounts)
  const found = new Map<string, ResumeCounts>()
  for (const id of ids) {
    const counts = cachedResumeCounts(id)
    if (counts && hintMessage(counts)) found.set(id, counts)
  }
  return found
}

/** 某个项目的会话数；空闲时自己触发一次查询（有缓存就直接用）。projectId 为 null 时一直是 null */
export function useResumeCounts(projectId: string | null | undefined, fetch = true): ResumeCounts | null {
  const counts = useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (projectId ? cachedResumeCounts(projectId) : null),
  )
  useEffect(() => {
    if (projectId && fetch) void ensureResumeCounts(projectId)
  }, [projectId, fetch])
  return counts
}

/** 打开某个项目的 /resume 选择器（列指定引擎的会话） */
export function openResumeFor(projectId: string, engine: HintEngine = 'claude'): void {
  openResumePicker({ projectId, engine })
}
