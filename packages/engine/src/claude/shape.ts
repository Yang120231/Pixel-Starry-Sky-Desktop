// 解析引擎原始 JSON 时的宽松取值：类型不对一律给空值，不抛错
export type Shape = Record<string, unknown>

export const obj = (v: unknown): Shape => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Shape) : {})
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** 非有限数（NaN / Infinity）也当作 0 */
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
