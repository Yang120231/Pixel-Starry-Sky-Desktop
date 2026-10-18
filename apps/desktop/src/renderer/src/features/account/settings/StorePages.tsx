import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../../i18n/core'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Spinner } from '@/ui'
import type { AccountInfo, AccountRefreshResult, StoreCatalog } from '../../../../../shared/types/account'
import { useStore } from '../useStore'
import { usePaymentWatch } from '../usePaymentWatch'
import { AccountCheckNotice, PaymentOutcome, StoreHeader, type OpenStore } from './StoreParts'
import { PlanStore } from './PlanStore'
import { TopUp } from './TopUp'

/**
 * 账号 → 订阅套餐 / 充值：读 Sub2api 的商品数据（docs/ui/settings.md §9.4–9.6）。
 * 付款在浏览器里的面板完成；打开支付页后前 2 分钟每 15 秒自动刷新账号，余额 / 套餐变了就提示到账。
 * 回到窗口时账号数据也会刷新（现有的焦点刷新），这里随之重读商品数据。
 */
export function StorePages({
  tab,
  account,
  onRefreshAccount,
}: {
  tab: 'plans' | 'topup'
  account: AccountInfo
  /** 强制发新请求刷新账号；返回刷新后的账号和失败原因 */
  onRefreshAccount: () => Promise<AccountRefreshResult>
}) {
  useI18n()
  const store = useStore(account.updatedAt)
  const watch = usePaymentWatch(account, onRefreshAccount)
  const [opened, setOpened] = useState(false)
  const [demoNote, setDemoNote] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  // 打开是异步的：返回前已离开页面就不再开始付款检测（StrictMode 会先清理再挂载，所以在 effect 里置回 true）
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // 打开前先刷新账号定基准（最多 5 秒），期间再点不重复打开
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const open: OpenStore = (kind, params) => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    setOpenError(null)
    setDemoNote(false)
    const done = (): void => {
      openingRef.current = false
      if (mounted.current) setOpening(false)
    }
    void (async () => {
      try {
        const baseline = await watch.prepare()
        if (!mounted.current) return
        const result = await store.open(kind, params)
        if (!mounted.current) return
        if (result === 'demo') {
          setDemoNote(true)
          return
        }
        setOpened(true)
        watch.begin(baseline)
      } catch (e) {
        if (mounted.current)
          setOpenError(translateMessage(e instanceof Error ? e.message : tr('settings.account.Store.openFailed')))
      } finally {
        done()
      }
    })()
  }

  const refreshAll = async (): Promise<void> => {
    // 商店数据随账号刷新（updatedAt 变化）由 useStore 静默重读，这里不重复读
    await watch.refreshNow()
  }

  const { state } = store
  let body
  if (state.status === 'loading') {
    body = (
      <div className="flex items-center gap-2 py-6 text-ui text-fg-muted">
        <Spinner />
        {tr('settings.account.Store.loading')}
      </div>
    )
  } else if (state.status === 'error') {
    body = (
      <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
        <div className="text-ui font-medium text-fg">{tr('settings.account.Store.loadFailed')}</div>
        <p role="alert" className="selectable mt-1 text-meta text-danger">
          {translateMessage(state.message)}
        </p>
        <Button variant="outline" icon={RefreshCw} className="mt-4" onClick={() => void store.reload()}>
          {tr('settings.account.Store.retry')}
        </Button>
      </div>
    )
  } else {
    const catalog: StoreCatalog = state.catalog
    body = (
      <div>
        {tab === 'plans' ? (
          <PlanStore catalog={catalog} currentPlan={account.plan?.name ?? null} onOpen={open} />
        ) : (
          <TopUp catalog={catalog} currency={account.currency} onOpen={open} />
        )}

        {opening && (
          <p className="mt-3 flex items-center gap-2 text-meta text-fg-muted">
            <Spinner />
            {tr('settings.account.Store.opening')}
          </p>
        )}
        {openError && (
          <p role="alert" className="selectable mt-3 text-meta text-danger">
            {openError}
          </p>
        )}
        {demoNote && <p className="mt-3 text-meta text-fg-muted">{tr('settings.account.Store.demoNoOpen')}</p>}
        {state.stale && <p className="mt-3 text-meta text-fg-faint">{tr('settings.account.Store.staleHint')}</p>}
        {opened && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-accent-line bg-accent-soft px-4 py-3">
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-meta text-fg-secondary">{tr('settings.account.Store.paidHint')}</p>
              <Button variant="outline" icon={RefreshCw} disabled={watch.refreshing} onClick={() => void refreshAll()}>
                {tr('settings.account.Store.paidRefresh')}
              </Button>
            </div>
            {watch.watching && !watch.outcome && (
              <p className="text-meta text-fg-faint">{tr('settings.account.Store.watching')}</p>
            )}
            {watch.error && (
              <p role="alert" className="selectable text-meta text-danger">
                {tr('settings.account.Store.refreshFailed', { p0: translateMessage(watch.error) })}
              </p>
            )}
            {watch.outcome && <PaymentOutcome outcome={watch.outcome} currency={account.currency} />}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <StoreHeader account={account} />
      <AccountCheckNotice email={account.email} />
      {body}
    </div>
  )
}
