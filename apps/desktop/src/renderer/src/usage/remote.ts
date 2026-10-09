// 账号远端调用记录的数据来源（docs/ui/usage.md §9.3）：
// - 演示模式：mock/remoteCalls.ts 的假数据；
// - 真实模式：通过主进程读取已上线的用户调用接口；
//   不存在时返回 NOT_IMPLEMENTED，页面显示「需认证服务提供接口」的占位说明。
import { useEffect, useState } from 'react'
import { isDemo } from '@/mock/data'
import { demoRemoteCalls } from '@/mock/remoteCalls'
import type { RemoteCallPage } from './remote-types'
import type { UsageRangeId } from './types'

export const NOT_IMPLEMENTED = 'not_implemented'

export interface RemoteCallsQuery {
  range: UsageRangeId
  /** 按模型筛选；null 表示不筛选。远端现在只支持模型和时间，传输更简单 */
  model: string | null
  offset: number
  limit: number
}

/** 兼容旧 preload；新版本通过 AccountBridge.listCalls 读取。 */
interface RemoteCallsBridge {
  listCalls?: (q: RemoteCallsQuery & { now: number }) => Promise<RemoteCallPage>
}

function bridge(): RemoteCallsBridge | null {
  const account = (window.pixelsky as unknown as { account?: RemoteCallsBridge } | undefined)?.account
  return account?.listCalls ? account : null
}

/** 远端接口是否已经可用（用于提示） */
export function remoteCallsAvailable(): boolean {
  return isDemo || bridge() !== null
}

export interface RemoteCallsResult {
  page: RemoteCallPage | null
  loading: boolean
  /** NOT_IMPLEMENTED = 服务端还没这个接口；其他字符串是错误信息 */
  error: string | null
  status: 'ready' | 'not-implemented' | 'error' | 'loading'
}

const DAY = 24 * 60 * 60 * 1000

/** 本地筛选 + 分页：演示数据，将来也可以在接口只给「整段数据」时用 */
function queryLocal(query: RemoteCallsQuery, now: number): RemoteCallPage {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const from =
    query.range === 'today'
      ? today.getTime()
      : query.range === '7d'
        ? today.getTime() - 6 * DAY
        : query.range === '30d'
          ? today.getTime() - 29 * DAY
          : today.getTime() - 89 * DAY
  const all = demoRemoteCalls(now)
    .filter(c => c.createdAt >= from && c.createdAt <= now && (query.model === null || c.model === query.model))
    .sort((a, b) => b.createdAt - a.createdAt)
  return {
    calls: all.slice(query.offset, query.offset + query.limit),
    total: all.length,
    offset: query.offset,
    nextCursor: null,
  }
}

/** 读取一页账号调用记录 */
export function useRemoteCalls(query: RemoteCallsQuery): RemoteCallsResult {
  const [result, setResult] = useState<RemoteCallsResult>({ page: null, loading: true, error: null, status: 'loading' })
  const key = JSON.stringify(query)

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const b = bridge()
    if (isDemo) {
      setResult({ page: queryLocal(query, now), loading: false, error: null, status: 'ready' })
      return
    }
    if (!b) {
      // 适配层还没这个接口（framework 阶段的真实模式）
      setResult({ page: null, loading: false, error: NOT_IMPLEMENTED, status: 'not-implemented' })
      return
    }
    setResult({ page: null, loading: true, error: null, status: 'loading' })
    b.listCalls!({ ...query, now })
      .then(page => !cancelled && setResult({ page, loading: false, error: null, status: 'ready' }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setResult({ page: null, loading: false, error: String((e as Error)?.message ?? e), status: 'error' }),
      )
    return () => {
      cancelled = true
    }
    // key 代替 query 对象做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return result
}

export type { CallClient, CallStatus, RemoteCall, RemoteCallPage } from './remote-types'
