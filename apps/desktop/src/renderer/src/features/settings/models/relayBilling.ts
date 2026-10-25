// 「从中转站读取」的建议倍率（docs/ui/custom-api.md §4.3）
import type { RelayBilling } from '../../../../../shared/types/providers'

type NewApi = Extract<RelayBilling, { kind: 'new-api' }>

/** 按哪个模型算：列表里第一个对得上官方价的 */
export const referenceModel = (b: NewApi): { id: string; factor: number } | null => {
  const m = b.models.find(x => x.factor !== null)
  return m ? { id: m.id, factor: m.factor! } : null
}

/** new-api 的建议倍率 = 分组倍率 × 模型价相对官方价的倍数 × 充值折扣，保留三位；算不出或超出 0～10 为 null */
export function newApiSuggestion(b: NewApi, group: string): number | null {
  const ratio = b.groups.find(g => g.name === group)?.ratio
  const ref = referenceModel(b)
  if (ratio === undefined || !ref) return null
  const value = Math.round(ratio * ref.factor * (b.recharge ?? 1) * 1000) / 1000
  return value >= 0 && value <= 10 ? value : null
}

/** 倍率写进输入框的样子：去掉多余的 0 */
export const multiplierText = (n: number): string => String(Math.round(n * 1000) / 1000)
