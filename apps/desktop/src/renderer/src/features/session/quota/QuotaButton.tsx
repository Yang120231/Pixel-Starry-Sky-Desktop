import { useEffect, useRef, useState } from 'react'
import type { QuotaProvider } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import type { ChannelId } from '@/features/model-channels/channelModel'
import { useQuotaDisplay } from '@/features/settings/quotaDisplay'
import { QuotaTrigger } from './QuotaTrigger'
import { QuotaPopover } from './QuotaPopover'
import { quotaButtonView, quotaButtonVisible } from './quotaModel'
import { useMinuteNow, useQuotaSource } from './quotaStore'
import { useQuotaTarget } from './useQuotaTarget'

export { QuotaTrigger }

/**
 * 输入框底栏的额度按钮（推理强度和上下文圆环之间，docs/ui/account-quota.md §6.5）。
 * 只有对话实际用的通道是 Claude 授权 / ChatGPT 授权 / 像素星空平台才出现；设置关掉、远程机器上的对话、没有数据时不出现。
 * 「这个对话用哪个通道」就是输入框控制器的 channel（已开始的对话取记录，没开始取全局默认）。
 */
export function QuotaButton({
  controller,
  sessionId,
  onOpenChannels,
}: {
  controller: { channel: ChannelId }
  sessionId: string | null
  /** 弹窗里的「换通道」：打开模型通道菜单 */
  onOpenChannels: () => void
}) {
  useI18n()
  const { provider, accountKey } = useQuotaTarget(controller.channel, sessionId)
  if (!provider) return null
  return (
    <QuotaButtonBody
      provider={provider}
      accountKey={accountKey}
      resetKey={`${sessionId ?? ''}|${provider}`}
      onOpenChannels={onOpenChannels}
    />
  )
}

function QuotaButtonBody({
  provider,
  accountKey,
  resetKey,
  onOpenChannels,
}: {
  provider: QuotaProvider
  accountKey: string | null
  resetKey: string
  onOpenChannels: () => void
}) {
  useI18n()
  const display = useQuotaDisplay()
  const source = useQuotaSource(provider, accountKey)
  const now = useMinuteNow()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // 换会话、换通道时收起弹窗
  useEffect(() => setOpen(false), [resetKey])
  if (!quotaButtonVisible(source.quota, source.loading, display.when, now, open, source.planLimits)) return null
  const view = quotaButtonView(source.quota, { provider, loading: source.loading, now, planLimits: source.planLimits })
  return (
    <span className="inline-flex shrink-0">
      <QuotaTrigger
        view={view}
        style={display.style}
        open={open}
        buttonRef={trigger}
        onClick={() => setOpen(v => !v)}
      />
      {open && (
        <QuotaPopover
          provider={provider}
          source={source}
          anchor={trigger}
          now={now}
          onClose={() => setOpen(false)}
          onOpenChannels={onOpenChannels}
        />
      )}
    </span>
  )
}
