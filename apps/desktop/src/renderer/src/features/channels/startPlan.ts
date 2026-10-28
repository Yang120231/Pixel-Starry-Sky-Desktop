// 开工时选这次用哪些 AI：没勾上的 AI 的步骤改派给勾上的（docs 见频道群聊界面美化 mockup 的「开工」弹窗）。纯函数。
import type { Effort } from '@pixelsky/protocol'
import { EFFORTS } from '@pixelsky/protocol'
import type { FlowStepInput, FlowStepSettings } from '../../../../shared/types/channels'

export interface PlannedStep {
  step: FlowStepInput
  /** 这次交给谁；一个 AI 都没勾时是 null */
  to: string | null
  /** 原来的成员没勾上（或不在频道里），改派了 */
  moved: boolean
}

/**
 * 每一步交给谁：标题空的步骤去掉（依赖它的步骤接着等它的依赖）；成员勾上了的照旧；
 * 没勾上的按顺序改派给步骤最少的勾上的成员（一样多时先给空闲的，再按列表顺序），
 * 审查步骤尽量别交给被审那一步的人
 */
export function assignSteps(
  steps: readonly FlowStepInput[],
  picked: readonly string[],
  busy: ReadonlySet<string> = new Set(),
): PlannedStep[] {
  const kept = dropEmpty(steps)
  const pool = new Set(picked)
  const load = new Map(picked.map(id => [id, 0]))
  for (const s of kept) if (pool.has(s.memberId)) load.set(s.memberId, (load.get(s.memberId) ?? 0) + 1)
  const out: PlannedStep[] = []
  const toOf = (id: string | null | undefined): string | null =>
    id ? (out.find(x => x.step.id === id)?.to ?? kept.find(x => x.id === id)?.memberId ?? null) : null
  for (const step of kept) {
    if (pool.has(step.memberId)) {
      out.push({ step, to: step.memberId, moved: false })
      continue
    }
    const avoid = step.kind === 'review' ? toOf(step.target) : null
    const cand = picked.length > 1 && avoid ? picked.filter(id => id !== avoid) : picked
    const to =
      [...cand].sort(
        (a, b) =>
          (load.get(a) ?? 0) - (load.get(b) ?? 0) ||
          Number(busy.has(a)) - Number(busy.has(b)) ||
          picked.indexOf(a) - picked.indexOf(b),
      )[0] ?? null
    if (to) load.set(to, (load.get(to) ?? 0) + 1)
    out.push({ step, to, moved: true })
  }
  return out
}

/** 去掉标题空的步骤；依赖和审查目标指向它的，改成它自己的依赖（先后关系不断） */
function dropEmpty(steps: readonly FlowStepInput[]): FlowStepInput[] {
  const empty = new Map(steps.filter(s => !s.title.trim()).map(s => [s.id, s]))
  if (!empty.size) return [...steps]
  const expand = (ids: readonly string[], seen = new Set<string>()): string[] =>
    ids.flatMap(id => {
      const e = empty.get(id)
      if (!e) return [id]
      if (seen.has(id)) return []
      seen.add(id)
      return expand(e.deps, seen)
    })
  return steps
    .filter(s => !empty.has(s.id))
    .map(s => ({
      ...s,
      deps: [...new Set(expand(s.deps))],
      ...(s.target && empty.has(s.target) ? { target: undefined } : {}),
    }))
}

/** 去掉没写的项（undefined / null / 空）；一项都没有是 undefined */
export function cleanStepSettings(s: FlowStepSettings): FlowStepSettings | undefined {
  const next = Object.fromEntries(
    Object.entries(s).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as FlowStepSettings
  return Object.keys(next).length ? next : undefined
}

/** 引擎能用的最低 / 最高推理强度（按 EFFORTS 的先后） */
export function effortEdge(efforts: readonly Effort[] | undefined, edge: 'low' | 'high'): Effort | undefined {
  const list = [...(efforts ?? [])].sort((a, b) => EFFORTS.indexOf(a) - EFFORTS.indexOf(b))
  return edge === 'low' ? list[0] : list.at(-1)
}

/** 最后交给主进程的步骤：成员换成这次的人，设置换成弹窗里定的 */
export function finalSteps(
  plan: readonly PlannedStep[],
  settingsOf: (p: PlannedStep) => FlowStepSettings,
): FlowStepInput[] {
  return plan.flatMap(p => {
    if (!p.to) return []
    const step: FlowStepInput = { ...p.step, memberId: p.to }
    delete step.settings
    const settings = cleanStepSettings(settingsOf(p))
    return [settings ? { ...step, settings } : step]
  })
}
