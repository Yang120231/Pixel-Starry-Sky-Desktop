// 反馈状态（docs/ui/feedback.md §2）：模块级 store，设置导航、侧栏红点、通知、反馈页共用同一份。
// 状态由主进程轮询、经 feedback:changed 推送；演示模式 / 没有桥时用内存里的示例（demo.ts），界面一样走。
import { useSyncExternalStore } from 'react'
import type { FeedbackBridge } from '../../../../preload/feedback'
import type { FeedbackChange, FeedbackState } from '../../../../shared/types/feedback'
import { createDemoFeedback } from './demo'

export interface FeedbackSnapshot extends FeedbackState {
  /** 第一次 state() 还没回来 */
  loading: boolean
}

const INITIAL: FeedbackSnapshot = {
  status: 'ready',
  email: null,
  unreadCount: 0,
  threads: [],
  nextBefore: null,
  error: null,
  checkedAt: null,
  loading: true,
}

let snapshot = INITIAL
let api: FeedbackBridge | null = null
let demo = false
let off: (() => void) | null = null
const listeners = new Set<() => void>()
const changeListeners = new Set<(change: FeedbackChange) => void>()

/** 演示模式或没有桥（浏览器里预览界面）时用示例数据 */
export const isDemoFeedback = (): boolean => !window.pixelsky?.feedback || window.pixelsky.demo === true

/** 当前使用的桥（第一次调用时决定是真的还是演示的） */
export function feedbackApi(): FeedbackBridge {
  if (!api) {
    demo = isDemoFeedback()
    api = demo ? createDemoFeedback() : window.pixelsky!.feedback
  }
  return api
}

function set(next: FeedbackSnapshot): void {
  snapshot = next
  listeners.forEach(fn => fn())
}

function start(): void {
  if (off) return
  const bridge = feedbackApi()
  let pushed = false
  const unsubscribe = bridge.onChange(change => {
    pushed = true
    set({ ...change.state, loading: false })
    // 演示模式不弹通知：它的 fresh 永远是空的，这里也不转发
    if (!demo) changeListeners.forEach(fn => fn(change))
  })
  off = unsubscribe
  bridge.state().then(
    state => {
      // 推送比 state() 先到时，旧结果丢掉
      if (!pushed) set({ ...state, loading: false })
    },
    () => set({ ...snapshot, loading: false, status: 'error', error: 'feedback unavailable' }),
  )
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  start()
  return () => {
    listeners.delete(fn)
  }
}

export const getFeedbackSnapshot = (): FeedbackSnapshot => snapshot

export function useFeedback(): FeedbackSnapshot {
  return useSyncExternalStore(subscribe, getFeedbackSnapshot)
}

/** 只关心红点的地方（侧栏、设置导航） */
export function useFeedbackUnread(): number {
  return useSyncExternalStore(subscribe, () => snapshot.unreadCount)
}

/** 每次检查的结果（含新出现的团队回复），给 FeedbackNotifier 弹系统通知；演示模式不转发 */
export function onFeedbackChange(fn: (change: FeedbackChange) => void): () => void {
  changeListeners.add(fn)
  start()
  return () => {
    changeListeners.delete(fn)
  }
}
