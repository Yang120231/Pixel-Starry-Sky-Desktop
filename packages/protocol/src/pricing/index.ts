// 按官方模型定价估算费用（docs/ui/custom-api.md §4.3）：自定义 API 的会话用，实际以接口账单为准
import type { ModelTurnUsage } from '../types'
import { OFFICIAL_PRICES } from './official'

export interface OfficialPrice {
  /** 价格表里的官方模型名 */
  model: string
  vendor: 'anthropic' | 'openai'
  /** 美元 / 百万 token */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  contextWindow: number | null
}

const price = (model: string): OfficialPrice | null => {
  const p = Object.prototype.hasOwnProperty.call(OFFICIAL_PRICES, model) ? OFFICIAL_PRICES[model] : undefined
  return p
    ? {
        model,
        vendor: p[0] === 'a' ? 'anthropic' : 'openai',
        input: p[1],
        output: p[2],
        cacheRead: p[3],
        cacheWrite: p[4],
        contextWindow: p[5],
      }
    : null
}

/** 去掉常见的前缀和后缀：anthropic/、openai/、us.anthropic. 之类、-20250929 / -2025-08-07 日期、-thinking、[1m]、-latest */
function stripModel(model: string): string {
  let m = model.trim().toLowerCase()
  m = m.replace(/\[[^\]]*\]$/, '')
  m = m.replace(/^.*\//, '')
  m = m.replace(/^(?:[a-z]{2}\.)?(?:anthropic|openai)\./, '')
  m = m.replace(/(?:-v\d+)?(?::\d+)?$/, '')
  m = m.replace(/-thinking$/, '')
  m = m.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, '')
  m = m.replace(/-latest$/, '')
  return m
}

/**
 * 模型对价格：先精确对，再去掉前缀和后缀对；都对不上用计价参照（ref）；还没有返回 null（只显示 token）。
 */
export function officialPrice(model: string, ref?: string | null): OfficialPrice | null {
  if (!model && !ref) return null
  const direct = model ? (price(model) ?? price(stripModel(model))) : null
  if (direct) return direct
  return ref ? (price(ref) ?? price(stripModel(ref))) : null
}

/** 这一轮这个模型的估算费用（美元）；对不上价格时为 null */
export function estimateCost(
  usage: Pick<ModelTurnUsage, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>,
  p: OfficialPrice | null,
): number | null {
  if (!p) return null
  const cost =
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.cacheRead +
      usage.cacheWrite * p.cacheWrite) /
    1e6
  return Number.isFinite(cost) ? cost : null
}

/** 价格表里的官方模型名（设置页「计价参照」的选项），可按厂商筛 */
export function officialModels(vendor?: OfficialPrice['vendor']): string[] {
  return Object.keys(OFFICIAL_PRICES)
    .filter(m => !vendor || (OFFICIAL_PRICES[m][0] === 'a') === (vendor === 'anthropic'))
    .filter(m => !/-\d{8}$|-\d{4}-\d{2}-\d{2}$/.test(m))
}
