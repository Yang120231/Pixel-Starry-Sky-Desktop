import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Spinner } from '@/ui'
import type { StoreCatalog } from '../../../../../shared/types/account'
import { useStore } from '../useStore'
import type { OpenStore } from './StoreParts'
import { PlanStore } from './PlanStore'
import { TopUp } from './TopUp'

/**
 * 账号 → 订阅套餐 / 充值：读 Sub2api 的商品数据（docs/ui/settings.md §9.4–9.6）。
 * 付款在浏览器里的面板完成；回到窗口时账号数据会刷新（现有的焦点刷新），这里随之重读商品数据。
 */
export function StorePages({
  tab,
  currentPlan,
  currency,
  updatedAt,
  onRefreshAccount,
}: {
  tab: 'plans' | 'topup'
  currentPlan: string | null
  /** 账号币种（额度、余额的单位） */
  currency: string
  /** 账号数据上次拉取的时间：变了就静默重读商品数据 */
  updatedAt: number
  onRefreshAccount: () => Promise<void>
}) {
  useI18n()
  const store = useStore(updatedAt)
  const [opened, setOpened] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const open: OpenStore = (kind, params) => {
    setOpenError(null)
    store.open(kind, params).then(
      () => setOpened(true),
      (e: unknown) => setOpenError(e instanceof Error ? e.message : tr('settings.account.Store.openFailed')),
    )
  }

  const refreshAll = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await onRefreshAccount()
      await store.reload()
    } finally {
      setRefreshing(false)
    }
  }

  const { state } = store
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-6 text-ui text-fg-muted">
        <Spinner />
        {tr('settings.account.Store.loading')}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
        <div className="text-ui font-medium text-fg">{tr('settings.account.Store.loadFailed')}</div>
        <p role="alert" className="selectable mt-1 text-meta text-danger">
          {state.message}
        </p>
        <Button variant="outline" icon={RefreshCw} className="mt-4" onClick={() => void store.reload()}>
          {tr('settings.account.Store.retry')}
        </Button>
      </div>
    )
  }

  const catalog: StoreCatalog = state.catalog
  return (
    <div>
      {tab === 'plans' ? (
        <PlanStore catalog={catalog} currentPlan={currentPlan} onOpen={open} />
      ) : (
        <TopUp catalog={catalog} currency={currency} onOpen={open} />
      )}

      {openError && (
        <p role="alert" className="selectable mt-3 text-meta text-danger">
          {openError}
        </p>
      )}
      {state.stale && <p className="mt-3 text-meta text-fg-faint">{tr('settings.account.Store.staleHint')}</p>}
      {opened && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-accent-line bg-accent-soft px-4 py-3">
          <p className="min-w-0 flex-1 text-meta text-fg-secondary">{tr('settings.account.Store.paidHint')}</p>
          <Button variant="outline" icon={RefreshCw} disabled={refreshing} onClick={() => void refreshAll()}>
            {tr('settings.account.Store.paidRefresh')}
          </Button>
        </div>
      )}
    </div>
  )
}
