import { tr } from '../i18n/core'
// 平台目录 + 全局默认的额度来源（docs/ui/source-switch.md §3）。
// - 目录：管理员公开且当前账号有权限的分组，每个分组的模型一次读齐（先选模型、再选线路）。
// - 全局默认：额度来源、平台的分组和模型、自有时的模型；新任务都用它。已开始的会话用自己记录里的选择（engine/hooks.ts）。
import { useEffect, useSyncExternalStore } from 'react'
import type { EngineId } from '@pixelsky/protocol'
import type { AccountState } from '../../../shared/types/account'
import type { PlatformGroupInfo } from '../../../shared/types/platform-catalog'
import { demoAccount } from '../mock/account'
import { demoPlatformGroups } from '../mock/platform'

export type CreditSource = 'platform' | 'self'

/** 全局默认（保存在本机） */
export interface SourcePreference {
  source: CreditSource
  /** 平台：分组和模型 */
  groupId: string | null
  model: string | null
  /** 自有：模型；null 表示跟随引擎自己的默认 */
  selfModel: string | null
}

/** 目录里的一个分组；models 读失败时 modelsError 有值 */
export interface PlatformGroup extends PlatformGroupInfo {
  modelsError: string | null
}

export interface PlatformState extends SourcePreference {
  /** 已登录的平台账号；null 表示未登录 */
  email: string | null
  /** 按管理员排序 */
  groups: PlatformGroup[]
  /** 目录读过至少一次（区分「还没读」和「读了但是空的」） */
  loaded: boolean
  loading: boolean
  error: string | null
  /** 菜单里不显示的平台模型（只记隐藏的，线路新加的模型默认显示；docs/ui/source-switch.md §8） */
  hiddenModels: string[]
}

const KEY = 'pixelsky.platform.preference.v1'
const HIDDEN_KEY = 'pixelsky.platform.hiddenModels'
const ENGINE_KEY = 'pixelsky.sources.v2'
let codexPreference: SourcePreference = { source: 'self', groupId: null, model: null, selfModel: null }
let codexUnsaved = true
try {
  const saved = JSON.parse(localStorage.getItem(ENGINE_KEY) ?? '{}').codex
  if (saved) {
    codexUnsaved = false
    codexPreference = {
      source: saved.source === 'platform' ? 'platform' : 'self',
      groupId: typeof saved.groupId === 'string' ? saved.groupId : null,
      model: typeof saved.model === 'string' ? saved.model : null,
      selfModel: typeof saved.selfModel === 'string' ? saved.selfModel : null,
    }
  }
} catch {
  /* 首次使用 */
}
let projections: Partial<Record<EngineId, PlatformState>> = {}
export function groupSupportsEngine(group: PlatformGroupInfo, engine: EngineId): boolean {
  if (group.supported_apis && !group.supported_apis.includes(engine === 'codex' ? 'responses' : 'messages'))
    return false
  if (group.supported_engines) return group.supported_engines.includes(engine)
  return engine === 'codex'
    ? group.platform === 'openai'
    : !group.platform || ['anthropic', 'claude'].includes(group.platform)
}
function saveEnginePreference(patch: Partial<SourcePreference>): void {
  codexUnsaved = false
  codexPreference = { ...codexPreference, ...patch }
  if (!window.pixelsky?.demo)
    try {
      localStorage.setItem(ENGINE_KEY, JSON.stringify({ codex: codexPreference }))
    } catch {
      /* 保留内存 */
    }
  set({})
}

function readHidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((m): m is string => typeof m === 'string') : []
  } catch {
    return []
  }
}

function readPreference(): SourcePreference {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    const s = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    return {
      source: p.source === 'self' ? 'self' : 'platform',
      groupId: s(p.groupId),
      model: s(p.model),
      selfModel: s(p.selfModel),
    }
  } catch {
    return { source: 'platform', groupId: null, model: null, selfModel: null }
  }
}

/** 本机还没保存过偏好（新装）：第一次读到账号状态时按「登录了用平台、没登录用自有」定默认 */
let unsaved = (() => {
  try {
    return localStorage.getItem(KEY) === null
  } catch {
    return true
  }
})()
let state: PlatformState = {
  ...readPreference(),
  email: null,
  groups: [],
  loaded: false,
  loading: false,
  error: null,
  hiddenModels: readHidden(),
}
const listeners = new Set<() => void>()
let started = false
/** 账号变了就加一，丢掉旧账号还没回来的请求 */
let generation = 0

function set(patch: Partial<PlatformState>, persist = false): void {
  state = { ...state, ...patch }
  projections = {}
  // 演示模式和正式版共用本机存储：演示里的选择只改内存，不覆盖真实的默认设置
  if (persist && !window.pixelsky?.demo) {
    unsaved = false
    const { source, groupId, model, selfModel } = state
    try {
      localStorage.setItem(KEY, JSON.stringify({ source, groupId, model, selfModel }))
    } catch {
      /* 存不下也能用当前选择 */
    }
  }
  listeners.forEach(fn => fn())
}

export function getPlatformState(engine: EngineId = 'claude'): PlatformState {
  if (!projections[engine]) {
    const groups = state.groups.filter(group => groupSupportsEngine(group, engine)),
      preference = engine === 'claude' ? state : codexPreference
    const resolved = resolvePlatform(groups, preference.groupId, preference.model)
    projections[engine] = { ...state, ...preference, groups, ...(state.loaded ? resolved : {}) }
  }
  return projections[engine]!
}

// ---------------------------------------------------------------------------
// 纯函数：会话和全局默认共用
// ---------------------------------------------------------------------------

/** 所有分组的模型并集，按分组顺序、组内顺序去重 */
export function platformModels(groups: PlatformGroup[]): string[] {
  const seen = new Set<string>()
  for (const g of groups) for (const m of g.models) seen.add(m)
  return [...seen]
}

/** 包含这个模型的分组，按有效倍率从低到高；倍率相同按管理员排序 */
export function groupsForModel(groups: PlatformGroup[], model: string | null): PlatformGroup[] {
  return groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => (model ? g.models.includes(model) : g.models.length > 0))
    .sort((a, b) => a.g.rate_multiplier - b.g.rate_multiplier || a.i - b.i)
    .map(({ g }) => g)
}

/**
 * 把（分组，模型）对齐到目录：先保模型——模型还在就换到包含它的分组（原分组有就不动，否则取倍率最低的）；
 * 模型不在了就保分组、取分组的第一个模型；都不在了取第一个有模型的分组。目录为空时两者都是 null。
 */
export function resolvePlatform(
  groups: PlatformGroup[],
  groupId: string | null,
  model: string | null,
): { groupId: string | null; model: string | null } {
  if (model) {
    const current = groups.find(g => g.id === groupId && g.models.includes(model))
    if (current) return { groupId: current.id, model }
    const cheapest = groupsForModel(groups, model)[0]
    if (cheapest) return { groupId: cheapest.id, model }
  }
  const group = groups.find(g => g.id === groupId && g.models.length > 0) ?? groups.find(g => g.models.length > 0)
  return group ? { groupId: group.id, model: group.models[0] } : { groupId: null, model: null }
}

/** 余额计费的分组在余额 ≤ 0 时发不出去（订阅额度的分组不看余额） */
export function needsBalance(group: PlatformGroupInfo | undefined): boolean {
  return !!group && group.billing_source !== 'plan_only'
}

/**
 * 余额计费的线路在余额 ≤ 0 时，Sub2api 连这条线路的模型列表都不给读（/v1/models 也做计费检查，返回 403），
 * 适配层只报「无法读取该分组的模型」。这种情况单独说清楚，别让人以为是后台没配模型。
 */
export function balanceBlocked(group: PlatformGroup, balance: number | null): boolean {
  return group.models.length === 0 && needsBalance(group) && balance !== null && balance <= 0
}

/** 一条线路读不出模型的原因；能用时为 null */
export function groupProblem(group: PlatformGroup, balance: number | null): string | null {
  if (balanceBlocked(group, balance)) return tr('account.platform.message6')
  if (group.modelsError) return tr('account.platform.message7', { p0: group.modelsError })
  return group.models.length === 0 ? tr('account.platform.message8') : null
}

/** 平台没有可用线路时给用户看的原因，balance 为真时提示充值 */
export function noRouteReason(
  s: Pick<PlatformState, 'groups' | 'error'>,
  balance: number | null,
): { message: string; balance: boolean } {
  if (s.groups.length === 0) return { message: s.error ?? tr('account.platform.message9'), balance: false }
  if (s.groups.every(g => balanceBlocked(g, balance))) {
    return {
      get message() {
        return tr('account.platform.message10')
      },
      balance: true,
    }
  }
  const first = s.groups.map(g => groupProblem(g, balance)).find(Boolean)
  return { message: first ?? s.error ?? tr('account.platform.message11'), balance: false }
}

export function billingLabel(group: PlatformGroupInfo): string {
  return group.billing_source === 'plan_only' ? tr('account.platform.message12') : tr('account.platform.message13')
}

/** ×0.8、×1、×0.125（最多三位小数） */
export function formatMultiplier(rate: number): string {
  return `×${Number(rate.toFixed(3))}`
}

// ---------------------------------------------------------------------------
// 目录读取
// ---------------------------------------------------------------------------

export async function refreshPlatform(): Promise<void> {
  const api = window.pixelsky?.platformCatalog
  // 演示模式用假目录，不请求真实服务
  if (!api || window.pixelsky?.demo || !state.email || state.loading) return
  const gen = generation
  set({ loading: true, error: null })
  try {
    const list = await api.groups()
    // 每个分组的模型一起读：先选模型、再选线路需要全部分组的模型
    const models = await Promise.allSettled(list.map(g => api.models(g.id)))
    if (gen !== generation) return
    const groups: PlatformGroup[] = list.map((g, i) => {
      const r = models[i]
      return r.status === 'fulfilled'
        ? { ...g, models: r.value, modelsError: null }
        : { ...g, models: [], modelsError: (r.reason as Error)?.message ?? tr('account.platform.message14') }
    })
    const anyModel = groups.some(g => g.models.length > 0)
    const error =
      groups.length > 0 && !anyModel
        ? (groups.find(g => g.modelsError)?.modelsError ?? tr('account.platform.message15'))
        : null
    set({ groups, loaded: true, loading: false, error, ...resolvePlatform(groups, state.groupId, state.model) }, true)
  } catch (e) {
    if (gen === generation) set({ groups: [], loaded: true, loading: false, error: (e as Error).message })
  }
}

// ---------------------------------------------------------------------------
// 全局默认（还没开始的会话改的就是它）
// ---------------------------------------------------------------------------

export function setDefaultSource(source: CreditSource, engine: EngineId = 'claude'): void {
  if (engine === 'codex') {
    saveEnginePreference({ source })
    return
  }
  set({ source }, true)
}

/** 平台：换模型，分组按「先保模型」对齐 */
export function setDefaultModel(model: string, engine: EngineId = 'claude'): void {
  const current = getPlatformState(engine),
    patch = { source: 'platform' as const, ...resolvePlatform(current.groups, current.groupId, model) }
  if (engine === 'codex') saveEnginePreference(patch)
  else set(patch, true)
}

/** 平台：换线路（分组）；分组没有当前模型时取它的第一个模型 */
export function setDefaultGroup(groupId: string, engine: EngineId = 'claude'): void {
  const current = getPlatformState(engine),
    group = current.groups.find(g => g.id === groupId)
  if (!group || group.models.length === 0) return
  const patch = {
    source: 'platform' as const,
    groupId,
    model: current.model && group.models.includes(current.model) ? current.model : group.models[0],
  }
  if (engine === 'codex') saveEnginePreference(patch)
  else set(patch, true)
}

export function setDefaultSelfModel(selfModel: string | null, engine: EngineId = 'claude'): void {
  if (engine === 'codex') {
    saveEnginePreference({ source: 'self', selfModel })
    return
  }
  set({ source: 'self', selfModel }, true)
}

// ---------------------------------------------------------------------------
// 菜单里显示哪些模型（§8）
// ---------------------------------------------------------------------------

function saveHidden(hiddenModels: string[]): void {
  set({ hiddenModels })
  if (window.pixelsky?.demo) return
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenModels))
  } catch {
    /* 存不下也能用 */
  }
}

export function setModelHidden(model: string, hidden: boolean): void {
  const rest = state.hiddenModels.filter(m => m !== model)
  saveHidden(hidden ? [...rest, model] : rest)
}

export function showAllModels(): void {
  saveHidden([])
}

/** 菜单里列出的模型：隐藏的不列，但 keep 里的（正在用的、默认的）照常显示，免得选中的东西不见了 */
export function visibleModels(models: string[], hidden: string[], keep: Array<string | null>): string[] {
  return models.filter(m => !hidden.includes(m) || keep.includes(m))
}

/** 模型多于这个数时显示搜索框 */
export const MODEL_SEARCH_MIN = 8

/** 按名字过滤模型（忽略大小写、空格和连字符） */
export function matchModels(models: string[], query: string): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '')
  const q = norm(query)
  return q ? models.filter(m => norm(m).includes(q)) : models
}

/** 「设为默认」：把一个会话的选择写回全局默认 */
export function saveDefault(p: Partial<SourcePreference>, engine: EngineId = 'claude'): void {
  if (engine === 'codex') {
    saveEnginePreference(p)
    return
  }
  set(p, true)
}

// ---------------------------------------------------------------------------
// 订阅
// ---------------------------------------------------------------------------

function start(): void {
  if (started) return
  started = true
  if (window.pixelsky?.demo) {
    // 演示模式：假目录，选择照常保存在内存里
    const groups = demoPlatformGroups.map(g => ({ ...g, modelsError: null }))
    set({ email: demoAccount.email, groups, loaded: true, ...resolvePlatform(groups, state.groupId, state.model) })
    return
  }
  const account = window.pixelsky?.account
  if (!account) return
  let pushed = false
  const apply = (next: AccountState, initial: boolean): void => {
    const email = next.status === 'signed-in' ? next.account.email : null
    if (email === state.email) {
      // 启动时没登录（email 和初始值一样是 null）：新装就把默认定为自有
      if (initial && unsaved) set({ source: 'self' }, true)
      return
    }
    generation++
    // 登录默认平台（D023）：这次运行中新登录的账号把默认来源设回平台；启动时读到的已登录状态不改用户的选择。
    // 新装还没选过：没登录就默认自有，免得第一次打开就被「请登录」挡住
    const source: CreditSource | undefined =
      !initial && email ? 'platform' : unsaved ? (email ? 'platform' : 'self') : undefined
    if (source || codexUnsaved) saveEnginePreference({ source: source ?? (email ? 'platform' : 'self') })
    set(
      { email, groups: [], loaded: false, loading: false, error: null, ...(source ? { source } : {}) },
      !!email || unsaved,
    )
    if (email) void refreshPlatform()
  }
  account.onChange(next => {
    pushed = true
    apply(next, false)
  })
  void account
    .getState()
    .then(next => {
      if (!pushed) apply(next, true)
    })
    .catch(() => undefined)
}

export function usePlatform(engine: EngineId = 'claude'): PlatformState {
  useEffect(start, [])
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => getPlatformState(engine),
  )
}
