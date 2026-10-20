// 会话摘要的 hook（算法见 sessionDigestModel.ts，docs/perf-audit-2026-10-18.md B3）
import { useEngineState } from './store'
import { digestsOf, type SessionDigest } from './sessionDigestModel'

export type { SessionDigest, TodoItem } from './sessionDigestModel'

/** 各会话的摘要；只有待处理请求或最新待办变了才换新对象 */
export function useSessionDigests(): Readonly<Record<string, SessionDigest>> {
  return useEngineState(s => digestsOf(s.snapshots))
}
