import { tr } from '../../i18n/core'
// 订阅套餐与充值的数据：设置 → 账号里「订阅套餐」「充值」共用一份（docs/ui/settings.md §9.6）。
// 真实构建读主进程的 account.store()；演示模式用演示目录。账号数据刷新（窗口聚焦、定时、手动）后静默重读。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoreCatalog, StoreLinkKind, StoreLinkParams } from '../../../../shared/types/account'
import { demo } from '@/data/demo'

export type StoreState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: StoreCatalog; stale: boolean }

export interface UseStoreResult {
  state: StoreState
  /** 重新读取；带着旧数据时不闪回加载态 */
  reload: () => Promise<void>
  /** 在浏览器里打开面板的购买页 / 兑换页；失败时抛出可读的错误 */
  open: (kind: StoreLinkKind, params?: StoreLinkParams) => Promise<void>
}

/** invoke 抛出的错误带着「Error invoking remote method 'xxx': Error: 」前缀，去掉后只留给用户看的那句话 */
export function cleanIpcError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const msg = raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '').trim()
  return msg || fallback
}

/** refreshKey 变化（账号数据刚刷新过）就静默重读一次 */
export function useStore(refreshKey: number): UseStoreResult {
  const isDemo = typeof window !== 'undefined' && window.pixelsky?.demo === true
  const [state, setState] = useState<StoreState>(() =>
    isDemo ? { status: 'ready', catalog: demo().store, stale: false } : { status: 'loading' },
  )
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const bridge = window.pixelsky?.account
    if (isDemo || !bridge) return
    const mine = ++seq.current
    setState(s => (s.status === 'ready' ? s : { status: 'loading' }))
    try {
      const catalog = await bridge.store()
      if (mine === seq.current) setState({ status: 'ready', catalog, stale: false })
    } catch (e) {
      if (mine !== seq.current) return
      const message = cleanIpcError(e, tr('settings.account.Store.loadFailed'))
      // 已有数据时刷新失败：留着旧数据，不把整页换成错误
      setState(s => (s.status === 'ready' ? { ...s, stale: true } : { status: 'error', message }))
    }
  }, [isDemo])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const open = useCallback(
    async (kind: StoreLinkKind, params?: StoreLinkParams) => {
      if (isDemo) return
      const bridge = window.pixelsky?.account
      if (!bridge) throw new Error(tr('settings.account.Store.openFailed'))
      try {
        await bridge.openStore(kind, params)
      } catch (e) {
        throw new Error(cleanIpcError(e, tr('settings.account.Store.openFailed')))
      }
    },
    [isDemo],
  )

  return { state, reload, open }
}
