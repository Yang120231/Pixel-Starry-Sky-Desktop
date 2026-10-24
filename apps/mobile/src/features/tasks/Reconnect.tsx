// 被别的设备顶掉（中转关闭码 4010，docs/cloud-admin-seats-plan.md §3）：不自动重连，由用户点「重新连接」。
// 断线横幅（docs/mobile-remote.md §25）：会话列表和会话页上面一条，分几种说清楚——电脑不在线 / 网络断开在重连（第几次、几秒后，
// 可以立即重试）/ 被顶掉；断开时页面内容和草稿都留着。重新连上后绿条闪一下。
import { useEffect, useRef, useState } from 'react'
import { CloudOff, MonitorSmartphone, WifiOff } from 'lucide-react'
import { connections } from '@/connection'
import { useLinkState } from '@/data/hooks'
import { L } from '@/i18n'
import { linkStateLabel } from '@/i18n/labels'
import { Banner, Button, Spinner } from '@/ui'

export const replacedTitle = () => L('已在其他设备连接', 'Connected on another device')
export const replacedBody = () =>
  L(
    '这个账号同时在线的设备超过了远程席位数，新连上的设备顶掉了这里。点「重新连接」会让那台设备断开；需要同时用可以在电脑的 设置 › 手机 里购买席位。',
    'This account has more devices online than it has remote seats, so a newly connected device took over from this one. Tapping “Reconnect” will disconnect that device. To use both at once, buy more seats on the computer in Settings › Phone.',
  )

export function ReconnectButton({ deviceId, size = 'md' }: { deviceId: string; size?: 'md' | 'sm' }) {
  return (
    <Button variant="primary" size={size} onClick={() => connections.reconnect(deviceId)}>
      {L('重新连接', 'Reconnect')}
    </Button>
  )
}

/** 断线时离下次自动重连还有几秒（每秒刷新）；没排着时 null */
function useRetryIn(deviceId: string, active: boolean): number | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(timer)
  }, [active])
  const at = connections.link(deviceId)?.retryAt
  return active && at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null
}

/**
 * 连接状态横幅：没连上时说清楚是哪种情况；从断开恢复时显示 2 秒「已重新连上」。
 * kept：断开时页面上还留着什么（「下面是断开前的内容」），没有就不写
 */
export function ConnectionBanner({ deviceId, kept }: { deviceId: string; kept?: string }) {
  const state = useLinkState(deviceId)
  const retryIn = useRetryIn(deviceId, state === 'offline')
  const retries = connections.link(deviceId)?.retries ?? 0
  // 断开过（不算第一次打开时的连接中）再连上：闪一下
  const wasDown = useRef(false)
  const [back, setBack] = useState(false)
  useEffect(() => {
    if (state === 'offline' || state === 'desktop_offline' || state === 'replaced') wasDown.current = true
    if (state !== 'ready' || !wasDown.current) return
    wasDown.current = false
    setBack(true)
    const timer = setTimeout(() => setBack(false), 2000)
    // 两秒内又断开：收起，不然下次连上时会一直挂着
    return () => {
      clearTimeout(timer)
      setBack(false)
    }
  }, [state])
  const suffix = kept ?? ''

  if (!state) return null
  if (state === 'ready') return back ? <Banner tone="ok">{L('已重新连上', 'Reconnected')}</Banner> : null
  if (state === 'replaced')
    return (
      <Banner
        tone="warn"
        icon={<MonitorSmartphone size={18} />}
        action={<ReconnectButton deviceId={deviceId} size="sm" />}
      >
        {L(
          `${replacedTitle()}：这个账号在别的设备上连上了，这里断开了。`,
          'This account connected on another device, so this one was disconnected.',
        )}
        {suffix && L(suffix, ` ${suffix}`)}
      </Banner>
    )
  if (state === 'offline')
    return (
      <Banner
        tone="warn"
        icon={<WifiOff size={18} />}
        action={
          <Button size="sm" onClick={() => connections.retryNow(deviceId)}>
            {L('立即重试', 'Retry now')}
          </Button>
        }
      >
        {L('网络断开了，正在重连', 'Network lost. Reconnecting')}
        {retries > 0 && (
          <span className="text-fg-muted">
            {L(
              `（第 ${retries} 次${retryIn !== null ? `，${retryIn} 秒后` : ''}）`,
              ` (attempt ${retries}${retryIn !== null ? `, in ${retryIn}s` : ''})`,
            )}
          </span>
        )}
        {L(`。${suffix}`, suffix ? `. ${suffix}` : '.')}
      </Banner>
    )
  if (state === 'desktop_offline')
    return (
      <Banner tone="warn" icon={<CloudOff size={18} />}>
        {L(
          '电脑不在线：可能关机、睡眠了，或没打开「允许手机远程连接」。电脑上线后会自动连上。',
          'Computer offline: it may be shut down or asleep, or “Allow remote phone connections” is off. It will connect automatically once the computer is back online.',
        )}
        {suffix && L(suffix, ` ${suffix}`)}
      </Banner>
    )
  return (
    <Banner tone="warn" icon={<Spinner size={14} />}>
      {linkStateLabel(state)}
      {suffix && ` ${suffix}`}
    </Banner>
  )
}
