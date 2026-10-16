import { useCallback, useRef } from 'react'

/**
 * 每一步第一次出现在界面上的时间（工具条目本身不带时间），算「几秒前」用（agentActivity.ts 的 agoText）；
 * 只增不减，组件重建时清空。进度卡片和智能体追踪共用
 */
export function useFirstSeen(): (id: string) => number {
  const seen = useRef(new Map<string, number>())
  return useCallback((id: string) => {
    let at = seen.current.get(id)
    if (at === undefined) {
      at = Date.now()
      seen.current.set(id, at)
    }
    return at
  }, [])
}
