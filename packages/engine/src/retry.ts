/** null 沿用引擎默认；0 是关闭，不能用 truthy 判断。 */
export function retryLimit(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 15) throw new Error('重试次数必须是 0～15 的整数')
  return value
}
