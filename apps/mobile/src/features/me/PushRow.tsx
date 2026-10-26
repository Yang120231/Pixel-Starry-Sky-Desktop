// 「设置 › 通用」里的锁屏提醒一行（docs/mobile-remote.md §22.2）：右边是 iOS 开关；电脑上有任务等你处理 / 完成 / 出错时，手机锁屏也能收到。
// 只画一行（Row），由设置页放进分组里；要先添加到主屏幕时没有开关，整行点进去看步骤。
import { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { disablePush, enablePush, pushState, type PushState } from '@/connection'
import { useConnections } from '@/data/hooks'
import { Row, cn } from '@/ui'
import { L } from '@/i18n'

const subtitles = (): Record<Exclude<PushState, 'unsupported'>, string> => ({
  install: L(
    'iPhone / iPad 要先添加到主屏幕，从桌面图标打开后再开',
    'On iPhone / iPad, add to Home Screen first, then turn this on after opening from the icon',
  ),
  denied: L(
    '通知被系统关掉了：到系统设置里允许这个网页（或主屏幕上的图标）发通知',
    'Notifications are turned off by the system: allow this site (or its Home Screen icon) to send notifications in system settings',
  ),
  off: L(
    '电脑上有任务等你处理、完成或出错时提醒你（不带任务内容）',
    'Alerts you when a task on your computer needs you, finishes or fails (without task content)',
  ),
  on: L(
    '已打开。网页开着时直接在页面上看，不另外提醒',
    'On. While the page is open you’ll see updates there, without extra alerts',
  ),
})

export function PushRow({ onInstall }: { onInstall: () => void }) {
  const { list } = useConnections()
  const [state, setState] = useState(pushState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (state === 'unsupported') return null

  const toggle = async () => {
    if (state === 'install') return onInstall()
    if (state === 'denied' || busy) return
    if (state === 'on' && !confirm(L('关掉锁屏提醒？', 'Turn off lock-screen alerts?'))) return
    setBusy(true)
    setError(null)
    try {
      if (state === 'on') setState(await disablePush(list))
      else {
        const r = await enablePush(list)
        setState(r.state)
        if (r.failed.length)
          setError(
            L(
              `${r.failed.join('、')} 没登记上，稍后关掉再打开一次`,
              `Couldn’t register ${r.failed.join(', ')}. Turn this off and on again later`,
            ),
          )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : L('没开成，稍后再试', 'Couldn’t turn on. Try again later'))
      setState(pushState())
    } finally {
      setBusy(false)
    }
  }

  const text = error ?? (busy ? L('正在设置…', 'Setting up…') : subtitles()[state])
  return (
    <Row
      icon={state === 'on' ? <Bell size={22} strokeWidth={1.5} /> : <BellOff size={22} strokeWidth={1.5} />}
      title={L('锁屏提醒', 'Lock-screen alerts')}
      // 说明比较长：让它在行里换行，不被 Row 的单行截断吃掉
      subtitle={<span className={cn('block whitespace-normal', error && 'text-danger')}>{text}</span>}
      trailing={
        state === 'on' || state === 'off' || state === 'denied' ? (
          <button
            type="button"
            role="switch"
            aria-checked={state === 'on'}
            aria-label={L('锁屏提醒', 'Lock-screen alerts')}
            disabled={state === 'denied' || busy}
            onClick={() => void toggle()}
            // iOS 开关：滑块用伪元素画，打开时底色变绿、滑块右移
            className={cn(
              'relative h-8 w-13 shrink-0 rounded-full transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-7 after:rounded-full after:bg-white after:shadow-sm after:transition-transform disabled:opacity-50',
              state === 'on' ? 'bg-success after:translate-x-5' : 'bg-line-strong',
            )}
          />
        ) : undefined
      }
      onClick={state === 'install' ? () => void toggle() : undefined}
      chevron={state === 'install'}
    />
  )
}
