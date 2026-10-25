// 流程（docs/ui/channels-pipeline.md §4）的纯函数：清洗草稿、校验、哪些步骤能开始、把拆好的流程变成步骤。
// 不碰磁盘和引擎；调度（开始一步、交付后接着走）在 service.ts
import { EFFORTS, type Effort } from '@pixelsky/protocol'
import type {
  ChannelFlow,
  FlowLimits,
  FlowSchedule,
  FlowStep,
  FlowStepKind,
  FlowStepSettings,
} from '../../../shared/types/channels'

export const FLOW_MAX_STEPS = 9
export const FLOW_MAX_REJECTS = 3
export const FLOW_TITLE_MAX = 60
/** 等别的成员回答超过这么久：流程停下等你看 */
export const ASK_TIMEOUT_MS = 30 * 60_000
const STEP_TITLE_MAX = 200
const KINDS: readonly FlowStepKind[] = ['work', 'review', 'summary']

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanSettings(raw: unknown): FlowStepSettings | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const out: FlowStepSettings = {}
  if (typeof r.model === 'string' && r.model.trim()) out.model = r.model.trim().slice(0, 200)
  if (EFFORTS.includes(r.effort as Effort)) out.effort = r.effort as Effort
  if (typeof r.fast === 'boolean') out.fast = r.fast
  if (typeof r.ultracode === 'boolean') out.ultracode = r.ultracode
  return Object.keys(out).length ? out : null
}

/** 界面传来的草稿步骤（不可信）→ 干净的步骤：运行时的字段全部重置，引用不存在的步骤去掉 */
export function cleanSteps(raw: unknown): FlowStep[] {
  if (!Array.isArray(raw)) throw new Error('步骤不正确')
  if (raw.length > FLOW_MAX_STEPS) throw new Error(`一个流程最多 ${FLOW_MAX_STEPS} 步`)
  const steps = raw.map((item, i): FlowStep => {
    const r = (item ?? {}) as Record<string, unknown>
    return {
      id: text(r.id, 64) || `s${i + 1}`,
      title: text(r.title, STEP_TITLE_MAX),
      memberId: text(r.memberId, 64),
      deps: Array.isArray(r.deps) ? r.deps.filter((d): d is string => typeof d === 'string') : [],
      kind: KINDS.includes(r.kind as FlowStepKind) ? (r.kind as FlowStepKind) : 'work',
      target: typeof r.target === 'string' ? r.target : null,
      settings: cleanSettings(r.settings),
      taskId: null,
      status: 'pending',
      rejects: 0,
      result: null,
      ...(r.gate === true ? { gate: true } : {}),
      copy: null,
    }
  })
  if (new Set(steps.map(s => s.id)).size !== steps.length) throw new Error('步骤 id 重复')
  const ids = new Set(steps.map(s => s.id))
  return steps.map(s => {
    const target = s.kind === 'review' && s.target && ids.has(s.target) && s.target !== s.id ? s.target : null
    // 审查一步：一定等被审的那一步交付
    const deps = [...new Set([...s.deps, ...(target ? [target] : [])])].filter(d => d !== s.id && ids.has(d))
    return { ...s, deps, target }
  })
}

/** 开始前的校验；没问题时 null。member：成员在不在这个频道、是不是本机的（SSH 成员没有频道工具） */
export function draftProblem(
  steps: readonly FlowStep[],
  member: (id: string) => { name: string; local: boolean } | null,
): string | null {
  if (!steps.length) return '流程里还没有步骤'
  for (const [i, s] of steps.entries()) {
    const no = `第 ${i + 1} 步`
    if (!s.title) return `${no}还没写要做什么`
    const m = member(s.memberId)
    if (!m) return `${no}还没选成员，或者这个成员不在频道里`
    if (!m.local) return `${no}的「${m.name}」在 SSH 机器上，流程暂时只支持本机的成员`
    if (s.kind === 'review' && !s.target) return `${no}是审查，要选审哪一步`
  }
  return hasCycle(steps) ? '步骤之间的先后关系绕成了圈' : null
}

function hasCycle(steps: readonly FlowStep[]): boolean {
  const deps = new Map(steps.map(s => [s.id, s.deps]))
  const state = new Map<string, 1 | 2>()
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false
    if (state.get(id) === 1) return true
    state.set(id, 1)
    if ((deps.get(id) ?? []).some(visit)) return true
    state.set(id, 2)
    return false
  }
  return steps.some(s => visit(s.id))
}

/** 现在能开始的步骤：还没开始（或被审查打回后等再审），依赖都交付了 */
export function startable(flow: ChannelFlow): FlowStep[] {
  const delivered = new Set(flow.steps.filter(s => s.status === 'delivered').map(s => s.id))
  return flow.steps.filter(s => s.status === 'pending' && s.deps.every(d => delivered.has(d)))
}

export const allDelivered = (flow: ChannelFlow): boolean => flow.steps.every(s => s.status === 'delivered')

/** 改一步：返回新的流程 */
export function withStep(flow: ChannelFlow, id: string, patch: Partial<FlowStep>): ChannelFlow {
  return { ...flow, steps: flow.steps.map(s => (s.id === id ? { ...s, ...patch } : s)) }
}

/**
 * 成员拆好的流程（task_done 的 steps，不可信）→ 草稿步骤。deps / target 用 1 开始的序号；
 * member 用名字，byName 找不到时报错，让它改了再交
 */
export function planSteps(raw: unknown, byName: (name: string) => string | null): FlowStep[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('steps 要是非空数组')
  if (raw.length > FLOW_MAX_STEPS) throw new Error(`一个流程最多 ${FLOW_MAX_STEPS} 步`)
  const ref = (n: unknown): string | null =>
    typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= raw.length ? `s${n}` : null
  return cleanSteps(
    raw.map((item, i) => {
      const r = (item ?? {}) as Record<string, unknown>
      const name = text(r.member, 64)
      const memberId = byName(name)
      if (!memberId) throw new Error(`第 ${i + 1} 步的成员「${name}」不在频道里`)
      return {
        id: `s${i + 1}`,
        title: r.title,
        memberId,
        deps: Array.isArray(r.deps) ? r.deps.map(ref).filter(Boolean) : [],
        kind: r.kind,
        target: ref(r.target),
      }
    }),
  )
}

// ── 护栏（docs/ui/channels-pipeline.md §6.2）──────────────────────────────

const ROUNDS_MAX = 200
const MINUTES_MIN = 5
const MINUTES_MAX = 1440
const COST_MIN = 0.01
const COST_MAX = 1000

/** 没设护栏时开始运行用的默认值 */
export const defaultLimits = (steps: number): FlowLimits => ({ rounds: Math.max(12, steps * 4), minutes: 120 })

/** 界面传来的护栏（不可信）：没传为 undefined（不改）；空 / null 是不限；数字截到范围里 */
export function cleanLimits(raw: unknown): FlowLimits | undefined {
  if (raw === undefined) return undefined
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown, min: number, max: number): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null
  }
  // 花费按分算，不取整
  const usd =
    typeof r.costUsd === 'number'
      ? r.costUsd
      : typeof r.costUsd === 'string' && r.costUsd.trim()
        ? Number(r.costUsd)
        : NaN
  return {
    rounds: num(r.rounds, 1, ROUNDS_MAX),
    minutes: num(r.minutes, MINUTES_MIN, MINUTES_MAX),
    costUsd: Number.isFinite(usd) ? Math.min(COST_MAX, Math.max(COST_MIN, Math.round(usd * 100) / 100)) : null,
  }
}

/** 超了哪一项护栏；used：流程里各步骤任务卡的轮次加起来；cost：已知花费（下限，没价格的部分不算） */
export function limitHit(flow: ChannelFlow, used: number, now: number, cost = 0): 'rounds' | 'time' | 'cost' | null {
  const { limits, since } = flow
  if (!limits || !since) return null
  if (limits.rounds !== null && used - since.rounds >= limits.rounds) return 'rounds'
  if (limits.costUsd != null && cost - (since.cost ?? 0) >= limits.costUsd) return 'cost'
  if (limits.minutes !== null && now - since.at >= limits.minutes * 60_000) return 'time'
  return null
}

// ── 并行步骤用 Git 副本（docs/ui/channels-pipeline.md §6.4）──────────────

/** 一步在哪做：主目录（merge：依赖在副本里，要合并的那几步）、沿用某个副本、新建副本（base：基于哪个分支，null 是主目录的 HEAD） */
export type CopyPlan =
  | { kind: 'main'; merge: string[] }
  | { kind: 'reuse'; copy: NonNullable<FlowStep['copy']> }
  | { kind: 'new'; name: string; branch: string; base: string | null }

/** 新副本的名字和分支：流程 id 前 6 位 + 步骤字母，重试时还是同一个 */
export function copyName(messageId: string, flow: ChannelFlow, stepId: string): { name: string; branch: string } {
  const i = flow.steps.findIndex(s => s.id === stepId)
  const name = `flow-${messageId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)}-${String.fromCharCode(97 + Math.max(0, i))}`
  return { name, branch: `pixelsky/${name}` }
}

/**
 * 这一步在哪做。来源 = 依赖所在的地方（主目录或某个副本）：
 * 依赖分在两处以上 → 汇合，在主目录合并；同一来源下还有别的步骤在做或同时开始 → 新建副本，基于来源分支；
 * 只有自己 → 沿用来源（副本或主目录）。已经有副本的一步（重试、打回、再审）一直用它
 */
export function copyPlan(flow: ChannelFlow, messageId: string, stepId: string, starting: readonly string[]): CopyPlan {
  const step = flow.steps.find(s => s.id === stepId)!
  if (step.copy) return { kind: 'reuse', copy: step.copy }
  const byId = new Map(flow.steps.map(s => [s.id, s]))
  const where = (s: FlowStep): string => s.copy?.id ?? 'main'
  const source = (s: FlowStep): string | null => {
    const set = new Set(
      s.deps
        .map(d => byId.get(d))
        .filter((d): d is FlowStep => !!d)
        .map(where),
    )
    return set.size > 1 ? null : ([...set][0] ?? 'main')
  }
  const mine = source(step)
  if (mine === null) return { kind: 'main', merge: step.deps.filter(d => byId.get(d)?.copy) }
  if (flow.isolate === false) return { kind: 'main', merge: [] }
  const busy = flow.steps.some(
    s =>
      s.id !== stepId &&
      (starting.includes(s.id) || s.status === 'running' || s.status === 'asking') &&
      source(s) === mine,
  )
  const from = mine === 'main' ? null : flow.steps.find(s => s.copy?.id === mine)!.copy!
  if (!busy) return from ? { kind: 'reuse', copy: from } : { kind: 'main', merge: [] }
  return { kind: 'new', ...copyName(messageId, flow, stepId), base: from?.branch ?? null }
}

// ── 每天定时运行（docs/ui/channels-pipeline.md §10.3）──────────────────────

export const SCHEDULE_MAX = 5

/** 界面传来的一条定时（不可信）：步骤清洗，护栏三项都要有，钟点 0–23；运行时的字段由调用方按 id 补 */
export function cleanSchedule(
  raw: unknown,
): Pick<FlowSchedule, 'title' | 'hour' | 'steps' | 'limits' | 'enabled' | 'isolate'> & { id: string | null } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const title = text(r.title, FLOW_TITLE_MAX)
  if (!title) throw new Error('定时运行要有名字')
  const hour = typeof r.hour === 'number' && Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23 ? r.hour : null
  if (hour === null) throw new Error('定时运行的钟点不对')
  const steps = cleanSteps(r.steps)
  if (!steps.length) throw new Error('定时运行里还没有步骤')
  const limits = cleanLimits(r.limits ?? {})!
  if (limits.rounds === null || limits.minutes === null || limits.costUsd == null)
    throw new Error('定时运行没人看着：轮次、时长、花费的上限都要设')
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 64) : null,
    title,
    hour,
    steps: steps.map(({ id, title, memberId, deps, kind, target, settings, gate }) => ({
      id,
      title,
      memberId,
      deps,
      kind,
      ...(target ? { target } : {}),
      ...(settings ? { settings } : {}),
      ...(gate ? { gate } : {}),
    })),
    limits: { rounds: limits.rounds, minutes: limits.minutes, costUsd: limits.costUsd },
    enabled: r.enabled !== false,
    ...(r.isolate === false ? { isolate: false } : {}),
  }
}

/** 今天该不该跑：开着、今天这个钟点已过、今天还没到点处理过（错过了当天任何时候补一次，跨多天也只补一次） */
export function scheduleDue(s: FlowSchedule, now: number): boolean {
  const due = new Date(now)
  due.setHours(s.hour, 0, 0, 0)
  return s.enabled && now >= due.getTime() && s.lastRunAt < due.getTime()
}
