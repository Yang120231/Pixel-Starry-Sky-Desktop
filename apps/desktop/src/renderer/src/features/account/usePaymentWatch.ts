// 付款到账检测的 React 外壳：控制器见 paymentWatch.ts
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { AccountInfo, AccountRefreshResult } from '../../../../shared/types/account'
import { PaymentWatch, type WatchState } from './paymentWatch'

export interface UsePaymentWatchResult extends WatchState {
  /** 支付页打开后调用：以当前账号数据为基准开始检测 */
  begin: () => void
  /** 「我已付款，刷新」 */
  refreshNow: () => Promise<void>
}

/** 离开商店页（组件卸载）时自动停止轮询 */
export function usePaymentWatch(
  account: Pick<AccountInfo, 'balance' | 'plan'>,
  refresh: () => Promise<AccountRefreshResult>,
): UsePaymentWatchResult {
  const accountRef = useRef(account)
  accountRef.current = account
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const watchRef = useRef<PaymentWatch | null>(null)
  watchRef.current ??= new PaymentWatch(() => refreshRef.current())
  const watch = watchRef.current

  useEffect(() => () => watch.stop(), [watch])
  const state = useSyncExternalStore(watch.subscribe, watch.getState, watch.getState)
  const begin = useCallback(() => watch.begin(accountRef.current), [watch])
  const refreshNow = useCallback(() => watch.manual(), [watch])
  return { ...state, begin, refreshNow }
}
