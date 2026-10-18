// 软件内付款的 React 外壳：弹窗流程见 checkoutFlow.ts；这里还管「继续付款」的待付单列表
// （弹窗关着时每 30 秒查一次，只为了更新剩余时间和发现已到账，docs/ui/in-app-payment.md §6.4）。
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { tr } from '../../../i18n/core'
import { useToast } from '@/ui'
import type { AccountInfo, AccountRefreshResult, CheckoutOrder } from '../../../../../shared/types/account'
import type { AccountBridge } from '../../../../../preload/account'
import { changeLines } from '../settings/StoreParts'
import { CheckoutFlow, type FlowBridge, type FlowState } from './checkoutFlow'
import { vanishedOrders, type CheckoutIntent } from './checkoutLogic'

export const PENDING_POLL_MS = 30_000

/** 待付单列表里的一笔：at 是收到它的本机时刻（算剩余时间用） */
export interface TrackedOrder {
  order: CheckoutOrder
  at: number
}

type AccountSnap = Pick<AccountInfo, 'balance' | 'plan' | 'currency'>

/** 充值页 / 套餐页用到的那一部分：开始付款、待付单、继续付款 */
export type CheckoutHost = Pick<UseCheckoutResult, 'start' | 'resume' | 'pending'>

export interface UseCheckoutResult {
  flow: CheckoutFlow
  state: FlowState
  /** 软件里下的、还没付的单（可能含已付款正在到账的，横条只显示 pending 的） */
  pending: TrackedOrder[]
  /** 点「扫码付款」；prepare 为真先显示「准备」步骤 */
  start: (intent: CheckoutIntent, prepare: boolean) => void
  /** 点「继续付款」 */
  resume: (orderId: number) => void
  /** 关闭弹窗（不取消订单）；还没付的单进待付列表 */
  close: () => void
}

/** 桥在调用时才取：没有桥（浏览器预览、演示）时 available 为假，不会走到这里 */
function api(): AccountBridge {
  const account = window.pixelsky?.account
  if (!account) throw new Error(tr('settings.account.Store.openFailed'))
  return account
}

const bridge: FlowBridge = {
  checkoutCreate: input => api().checkoutCreate(input),
  checkoutGet: id => api().checkoutGet(id),
  checkoutVerify: id => api().checkoutVerify(id),
  checkoutCancel: id => api().checkoutCancel(id),
  checkoutOpenPayUrl: id => api().checkoutOpenPayUrl(id),
  panelStatus: () => api().panelStatus(),
  panelVerify: () => api().panelVerify(),
}

const foreground = (): boolean => typeof document === 'undefined' || (!document.hidden && document.hasFocus())

/** 关掉弹窗时手里的订单：还没付的、或已付款正在到账的留在待付列表里（不取消），关了弹窗也能「继续付款」 */
export function trackClosed(list: TrackedOrder[], order: CheckoutOrder, at: number): TrackedOrder[] {
  if (order.status !== 'pending' && order.status !== 'paid') return list
  return [{ order: plain(order), at }, ...list.filter(t => t.order.orderId !== order.orderId)]
}

/** 不带二维码和支付链接的副本：列表里只需要金额和时间 */
const plain = (o: CheckoutOrder): CheckoutOrder => ({ ...o, qrContent: null, qrSource: null, payUrl: null })

/**
 * available 为假（云端没开软件内付款，或在演示 / 没有桥的环境）时什么都不做：不查待付单、start / resume 也不会下单。
 * 离开页面（卸载）时关掉弹窗、停掉所有定时器
 */
export function useCheckout(
  account: AccountSnap,
  available: boolean,
  refresh: () => Promise<AccountRefreshResult>,
): UseCheckoutResult {
  const toast = useToast()
  const accountRef = useRef(account)
  accountRef.current = account
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [pending, setPending] = useState<TrackedOrder[]>([])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const refreshPendingRef = useRef<() => Promise<void>>(async () => undefined)

  const flowRef = useRef<CheckoutFlow | null>(null)
  flowRef.current ??= new CheckoutFlow({
    bridge,
    refreshAccount: () => refreshRef.current(),
    getAccount: () => accountRef.current,
    newRequestId: () => crypto.randomUUID(),
    onCompleted: (_order, change) => {
      const line = change ? changeLines(change, accountRef.current.currency)[0] : undefined
      toastRef.current(
        line
          ? tr('settings.account.Checkout.toast.completedWith', { p0: line })
          : tr('settings.account.Checkout.toast.completed'),
      )
    },
    onLateOrder: () => void refreshPendingRef.current(),
    foreground,
  })
  const flow = flowRef.current
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState)

  // 前后台变化：回到前台马上查一次订单
  useEffect(() => {
    const changed = (): void => flow.foregroundChanged()
    document.addEventListener('visibilitychange', changed)
    window.addEventListener('focus', changed)
    window.addEventListener('blur', changed)
    return () => {
      document.removeEventListener('visibilitychange', changed)
      window.removeEventListener('focus', changed)
      window.removeEventListener('blur', changed)
    }
  }, [flow])
  useEffect(() => () => flow.dispose(), [flow])

  // 待付单：弹窗关着时每 30 秒查一次。列表里消失的订单可能已经到账，单独查一次；还在到账的继续跟着
  useEffect(() => {
    if (!available) {
      setPending([])
      return
    }
    let alive = true
    let busy = false
    const run = async (): Promise<void> => {
      const api = window.pixelsky?.account
      if (busy || !api?.checkoutPending || flow.getState().open) return
      busy = true
      try {
        const listed = await api.checkoutPending()
        const at = Date.now()
        const next: TrackedOrder[] = listed.map(order => ({ order, at }))
        for (const id of vanishedOrders(
          pendingRef.current.map(t => t.order),
          listed,
        )) {
          const fresh = await api.checkoutGet(id).catch(() => null)
          const old = pendingRef.current.find(t => t.order.orderId === id)
          if (!fresh) {
            if (old) next.push(old) // 查不到就先留着，下次再查
          } else if (fresh.status === 'paid') next.push({ order: plain(fresh), at: Date.now() })
          else if (fresh.status === 'completed' && !flow.getState().open) {
            // 弹窗关着的时候到的账：刷新账号让余额 / 套餐跟上，并提示一下
            void refreshRef.current().catch(() => undefined)
            toastRef.current(tr('settings.account.Checkout.toast.completed'))
          }
        }
        if (alive) setPending(next)
      } catch {
        /* 查不到就保持现状，下一拍再来 */
      } finally {
        busy = false
      }
    }
    refreshPendingRef.current = run
    void run()
    const timer = setInterval(() => void run(), PENDING_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
      refreshPendingRef.current = async () => undefined
    }
  }, [available, flow])

  const start = useCallback(
    (intent: CheckoutIntent, prepare: boolean) => {
      if (available) flow.begin(intent, prepare)
    },
    [available, flow],
  )
  const resume = useCallback(
    (orderId: number) => {
      if (available) flow.resume(orderId)
    },
    [available, flow],
  )
  const close = useCallback(() => {
    const receivedAt = flow.getState().receivedAt || Date.now()
    const order = flow.close()
    if (order) setPending(list => trackClosed(list, order, receivedAt))
    void refreshPendingRef.current()
  }, [flow])

  return { flow, state, pending, start, resume, close }
}
