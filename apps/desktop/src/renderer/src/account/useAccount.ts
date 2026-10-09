import { tr } from '../i18n/core'
// 账号状态：模块级 store，所有调用方共享同一份（一次 getState + 一个 onChange 订阅）
// 规格见 docs/ui/account.md §4.3
import { useMemo, useSyncExternalStore } from 'react'
import type { AccountInfo, AccountState } from '../../../shared/types/account'
import type { AccountBridge } from '../../../preload/account'
import { demoAccount } from '../mock/account'
import { formatBalance } from './format'

export type AccountStatus = 'loading' | 'signed-out' | 'signing-in' | 'signed-in'

export interface AccountUser {
  name: string
  email: string
}

export interface UseAccountResult {
  status: AccountStatus
  account: AccountInfo | null
  user: AccountUser | null
  /** 格式化好的余额（如 "$12.34"）；未登录时为 null */
  balanceText: string | null
  error: string | null
  refreshing: boolean
  login: () => Promise<void>
  cancelLogin: () => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

interface Snapshot {
  status: AccountStatus
  account: AccountInfo | null
  refreshing: boolean
  error: string | null
}

const LOADING: Snapshot = { status: 'loading', account: null, refreshing: false, error: null }
const SIGNED_OUT: Snapshot = { status: 'signed-out', account: null, refreshing: false, error: null }
const DEMO: Snapshot = { status: 'signed-in', account: demoAccount, refreshing: false, error: null }

function getBridge(): AccountBridge | null {
  return window.pixelsky?.account ?? null
}

function isDemoMode(): boolean {
  return window.pixelsky?.demo === true
}

function toSnapshot(s: AccountState): Snapshot {
  switch (s.status) {
    case 'signed-out':
      return { status: 'signed-out', account: null, refreshing: false, error: s.error ?? null }
    case 'signing-in':
      return { status: 'signing-in', account: null, refreshing: false, error: null }
    case 'signed-in':
      return { status: 'signed-in', account: s.account, refreshing: s.refreshing, error: s.error ?? null }
  }
}

// ---- store ----
let snapshot: Snapshot = LOADING
let started = false
let gotPush = false // onChange 已经推送过：此时 getState 的旧结果要丢弃
const listeners = new Set<() => void>()

function setSnapshot(next: Snapshot) {
  snapshot = next
  listeners.forEach(l => l())
}

function errorText(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return msg || fallback
}

function start() {
  if (started) return
  started = true
  const bridge = getBridge()
  if (!bridge) return
  try {
    bridge.onChange(s => {
      gotPush = true
      setSnapshot(toSnapshot(s))
    })
  } catch {
    // 订阅失败时仍然尝试读一次状态
  }
  bridge
    .getState()
    .then(s => {
      if (!gotPush) setSnapshot(toSnapshot(s))
    })
    .catch(e => {
      if (!gotPush) setSnapshot({ ...SIGNED_OUT, error: errorText(e, tr('account.useAccount.message16')) })
    })
}

function subscribe(listener: () => void): () => void {
  if (isDemoMode()) return () => {}
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Snapshot {
  if (isDemoMode()) return DEMO
  // 没有桥接（普通浏览器）：直接是未登录，不必等待
  if (!getBridge()) return SIGNED_OUT
  return snapshot
}

/** 把动作里抛出的错误写进状态（已登录时保留账号信息，只挂上错误提示） */
function routeError(e: unknown, fallback: string) {
  const error = errorText(e, fallback)
  if (snapshot.status === 'signed-in') setSnapshot({ ...snapshot, refreshing: false, error })
  else setSnapshot({ ...SIGNED_OUT, error })
}

function makeAction(name: 'login' | 'cancelLogin' | 'logout' | 'refresh', fallback: () => string) {
  return async (): Promise<void> => {
    if (isDemoMode()) return
    const bridge = getBridge()
    if (!bridge) return
    try {
      await bridge[name]()
    } catch (e) {
      routeError(e, fallback())
    }
  }
}

const login = makeAction('login', () => tr('account.useAccount.message17'))
const cancelLogin = makeAction('cancelLogin', () => tr('account.useAccount.message18'))
const logout = makeAction('logout', () => tr('account.useAccount.message19'))
const refresh = makeAction('refresh', () => tr('account.useAccount.message20'))

/** 账号状态钩子。所有调用方共享同一个 store；操作函数引用稳定、不会抛出 */
export function useAccount(): UseAccountResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo<UseAccountResult>(() => {
    const account = snap.account
    return {
      status: snap.status,
      account,
      user: account ? { name: account.name || account.email.split('@')[0], email: account.email } : null,
      balanceText: account ? formatBalance(account.balance, account.currency) : null,
      error: snap.error,
      refreshing: snap.refreshing,
      login,
      cancelLogin,
      logout,
      refresh,
    }
  }, [snap])
}
