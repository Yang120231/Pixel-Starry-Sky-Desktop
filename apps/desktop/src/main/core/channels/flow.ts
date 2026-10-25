// 流程（docs/ui/channels-pipeline.md §4）的纯函数：清洗草稿、校验、哪些步骤能开始、把拆好的流程变成步骤。
// 不碰磁盘和引擎；调度（开始一步、交付后接着走）在 service.ts
import { EFFORTS, type Effort } from '@pixelsky/protocol'
import type { ChannelFlow, FlowStep, FlowStepKind, FlowStepSettings } from '../../../shared/types/channels'

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
