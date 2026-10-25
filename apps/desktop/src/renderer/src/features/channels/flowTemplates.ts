// 流程模板（docs/ui/channels-pipeline.md §8.1）：不带成员 id 的草稿，存在本机界面（localStorage），不走主进程
import { useSyncExternalStore } from 'react'
import type { EngineId } from '@pixelsky/protocol'
import type { ChannelFlow, FlowLimits, FlowStepInput } from '../../../../shared/types/channels'
import type { ChannelMember } from '@/data/types'

const KEY = 'pixelsky.channels.flowTemplates'
export const TEMPLATE_MAX = 30
export const TEMPLATE_NAME_MAX = 40

export interface TemplateStep {
  id: string
  title: string
  /** 成员名字（换频道也能套） */
  member: string
  /** 存模板时这个成员的引擎：套用时引擎相同才保留模型 */
  engine?: EngineId
  deps: string[]
  kind: FlowStepInput['kind']
  target?: string
  settings?: FlowStepInput['settings']
  gate?: boolean
}

export interface FlowTemplate {
  id: string
  name: string
  steps: TemplateStep[]
  limits?: FlowLimits
  isolate?: boolean
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const KINDS = ['work', 'review', 'summary']

function validStep(s: unknown): s is TemplateStep {
  const x = s as TemplateStep
  return (
    !!x &&
    isStr(x.id) &&
    isStr(x.title) &&
    isStr(x.member) &&
    KINDS.includes(x.kind) &&
    Array.isArray(x.deps) &&
    x.deps.every(isStr)
  )
}

function validTemplate(t: unknown): t is FlowTemplate {
  const x = t as FlowTemplate
  return (
    !!x &&
    isStr(x.id) &&
    isStr(x.name) &&
    x.name.trim() !== '' &&
    Array.isArray(x.steps) &&
    x.steps.length > 0 &&
    x.steps.every(validStep)
  )
}

/** 读出来的内容逐个校验，坏的丢掉；整个读不出来是空 */
export function parseTemplates(raw: string | null): FlowTemplate[] {
  try {
    const list = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(list) ? list.filter(validTemplate).slice(0, TEMPLATE_MAX) : []
  } catch {
    return []
  }
}

let templates: FlowTemplate[] = typeof localStorage !== 'undefined' ? parseTemplates(localStorage.getItem(KEY)) : []
const listeners = new Set<() => void>()

function commit(next: FlowTemplate[]): void {
  templates = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 存不了就只在这次有效 */
  }
  for (const l of listeners) l()
}

/** 存一个模板；满了返回 false */
export function saveTemplate(t: Omit<FlowTemplate, 'id'>): boolean {
  if (templates.length >= TEMPLATE_MAX) return false
  commit([...templates, { ...t, id: crypto.randomUUID(), name: t.name.trim().slice(0, TEMPLATE_NAME_MAX) }])
  return true
}

export function deleteTemplate(id: string): void {
  commit(templates.filter(t => t.id !== id))
}

export function useFlowTemplates(): FlowTemplate[] {
  return useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => templates,
  )
}

/** 流程 → 模板（不存运行时状态和结果）；lookup 按成员 id 给名字和引擎 */
export function toTemplate(
  flow: { steps: readonly FlowStepInput[]; limits?: ChannelFlow['limits']; isolate?: boolean },
  name: string,
  lookup: (memberId: string) => { name: string; engine?: EngineId } | undefined,
): Omit<FlowTemplate, 'id'> {
  return {
    name: name.trim().slice(0, TEMPLATE_NAME_MAX),
    steps: flow.steps.map(s => {
      const m = lookup(s.memberId)
      return {
        id: s.id,
        title: s.title,
        member: m?.name ?? '',
        ...(m?.engine ? { engine: m.engine } : {}),
        deps: s.deps,
        kind: s.kind,
        ...(s.target ? { target: s.target } : {}),
        ...(s.settings && Object.keys(s.settings).length ? { settings: s.settings } : {}),
        ...(s.gate ? { gate: true } : {}),
      }
    }),
    ...(flow.limits ? { limits: flow.limits } : {}),
    ...(flow.isolate !== undefined ? { isolate: flow.isolate } : {}),
  }
}

/** 模板里的花费上限：不是正数（旧模板没有、数据坏了）就是不限 */
const validCost = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** 套用：成员按名字（不分大小写）对上，对不上的步骤 memberId 留空；模型只在引擎相同时保留；{request} 换成这句话 */
export function applyTemplate(
  t: FlowTemplate,
  request: string,
  agents: readonly ChannelMember[],
): { title: string; steps: FlowStepInput[]; limits?: FlowLimits; isolate?: boolean; unmatched: number } {
  let unmatched = 0
  const steps = t.steps.map((s): FlowStepInput => {
    const m = agents.find(a => a.kind === 'agent' && a.name.toLowerCase() === s.member.toLowerCase())
    if (!m) unmatched++
    let settings = s.settings
    if (settings?.model && !(m?.kind === 'agent' && s.engine && m.engine === s.engine)) {
      const rest = { ...settings }
      delete rest.model
      settings = rest
    }
    return {
      id: s.id,
      title: s.title.replaceAll('{request}', request),
      memberId: m?.id ?? '',
      deps: s.deps,
      kind: s.kind,
      ...(s.target ? { target: s.target } : {}),
      ...(settings && Object.keys(settings).length ? { settings } : {}),
      ...(s.gate ? { gate: true } : {}),
    }
  })
  return {
    title: request,
    steps,
    ...(t.limits ? { limits: { ...t.limits, costUsd: validCost(t.limits.costUsd) } } : {}),
    ...(t.isolate !== undefined ? { isolate: t.isolate } : {}),
    unmatched,
  }
}
