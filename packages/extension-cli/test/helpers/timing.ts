// 测速类问题和机器快慢有关（CI 机器上 dotenv 示例最慢一行能到 15 ms，接近 30 ms 上限就会多一条提示）。
// 用真实引擎跑的测试比较结果前先去掉它们；这几种问题本身由 grammar.test.ts 里注入时钟的用例覆盖。
export const TIMING_CODES: ReadonlySet<string> = new Set([
  'grammar.slowLine',
  'grammar.slowTotal',
  'grammar.perfNearLimit',
])

export const withoutTiming = <T extends { code: string }>(issues: readonly T[]): T[] =>
  issues.filter(i => !TIMING_CODES.has(i.code))
