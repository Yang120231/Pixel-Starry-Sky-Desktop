import type { EngineQuotaProvider } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/ui'
import { quotaButtonView, type QuotaLevel } from './quotaModel'
import { useMinuteNow, useQuotaSnapshot } from './quotaStore'
import { useQuotaTarget } from './useQuotaTarget'

const TONE: Record<QuotaLevel, string> = { normal: 'text-fg-muted', warn: 'text-warn', full: 'text-danger' }

/**
 * 模型通道菜单里 Claude / ChatGPT 授权账号后面的额度简写「· 5h 42%」（docs/ui/account-quota.md §6.7）。
 * 只读存储里的值（空时问一次缓存，不触发读取）；设置关掉、不是本机、引擎没就绪或不是授权登录、没数据、读取失败时什么都不显示。
 */
export function QuotaInline({ provider }: { provider: EngineQuotaProvider }) {
  useI18n()
  // 出现条件和额度按钮一样（设置、本机、引擎可用、登录方式）：Codex 改成 API Key 之后不再显示旧额度
  const target = useQuotaTarget(provider, null)
  // 条件不满足时不把（可能是别的机器的）账号告诉存储，免得误清本机的数据
  const quota = useQuotaSnapshot(provider, target.provider === provider ? target.accountKey : undefined)
  const now = useMinuteNow()
  if (target.provider !== provider) return null
  if (!quota || quota.status !== 'ok') return null
  const view = quotaButtonView(quota, { provider, loading: false, now })
  const text = [view.short, view.value].filter(Boolean).join(' ')
  if (!text) return null
  return (
    <span
      data-quota-inline
      title={view.title}
      className={cn('flex shrink-0 items-center gap-1.5 tabular-nums', TONE[view.level])}
    >
      <span aria-hidden className="text-fg-faint">
        ·
      </span>
      <span aria-label={view.label}>{text}</span>
    </span>
  )
}
