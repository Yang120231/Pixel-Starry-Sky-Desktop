// 「终端里有原来的 AI 会话，点一下接着聊」的提示：查询、缓存、并发限制、文案（纯函数）。
// 导入项目之后（设置 › 项目的结果行、别的入口的提示条）和项目里还没有对话时的空状态共用同一份结果。
import { useEffect, useSyncExternalStore } from 'react'
import type { NativeSessionSummary } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { listNativeSessions } from '@/features/engine/store'
import { machineOf } from '@/features/machines/store'
import { openResumePicker } from './store'

export type HintEngine = 'claude' | 'codex'
export type ResumeCounts = Partial<Record<HintEngine, number>>

/** 现在会去查、也能打开选择器的引擎。Codex 版选择器做好后加进来就行，文案和查询已经按引擎写好 */
export const HINT_ENGINES: readonly HintEngine[] = ['claude']
/** 同时最多几个查询在跑 */
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

type Lister = (projectId: string, engine: HintEngine) => Promise<readonly NativeSessionSummary[]>
const defaultLister: Lister = (projectId, engine) => listNativeSessions(projectId, { engine, subfolders: true })

/** 查一个项目的会话数。远程机器 / WSL 项目、查询失败、引擎不支持都按「没有」处理，不抛错 */
export async function fetchResumeCounts(
  projectId: string,
  list: Lister = defaultLister,
  engines: readonly HintEngine[] = HINT_ENGINES,
): Promise<ResumeCounts> {
  if (machineOf(projectId) !== 'local') return {}
  const counts: ResumeCounts = {}
  for (const engine of engines) {
    try {
      const n = resumableCount(await list(projectId, engine))
      if (n > 0) counts[engine] = n
    } catch {
      /* 当作没有 */
    }
  }
  return counts
}

// ---------- 缓存（按项目；一分钟内不重查） ----------
interface Entry {
  counts: ResumeCounts | null
  at: number
  pending: Promise<void> | null
}
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(l => l())
let lister: Lister = defaultLister

/** 测试用 */
export function resetResumeHints(next: Lister = defaultLister): void {
  cache.clear()
  lister = next
  emit()
}

export function cachedResumeCounts(projectId: string): ResumeCounts | null {
  return cache.get(projectId)?.counts ?? null
}

/** 查一个项目（有新鲜缓存或正在查就不再查） */
export function ensureResumeCounts(projectId: string): Promise<void> {
  const hit = cache.get(projectId)
  if (hit?.pending) return hit.pending
  if (hit?.counts && Date.now() - hit.at < TTL_MS) return Promise.resolve()
  const entry: Entry = { counts: hit?.counts ?? null, at: hit?.at ?? 0, pending: null }
  entry.pending = fetchResumeCounts(projectId, lister).then(counts => {
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

/** 打开某个项目的 /resume 选择器。选择器现在只支持 Claude Code，别的引擎先打开 Claude 的 */
export function openResumeFor(projectId: string, engine: HintEngine = 'claude'): void {
  void engine
  openResumePicker({ projectId })
}
