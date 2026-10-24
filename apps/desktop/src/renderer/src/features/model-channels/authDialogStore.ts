// 授权弹窗开在哪条通道（docs/ui/model-channels.md §3）：输入框菜单、提示条、设置卡片都能打开，弹窗只挂一个（AuthDialogHost）。
// 错误卡片的「重新登录」（docs/ui/claude-login-recovery.md §1 第 4 条）还带上要重新登录的账号和登录好后要做的事（重发那条消息）
import { useSyncExternalStore } from 'react'
import type { AuthChannel } from './channelModel'

export interface AuthDialogRequest {
  channel: AuthChannel
  /** 订阅账号多开时重新登录的账号 id；不传是当前账号的普通登录 */
  target?: string
  /** 登录成功后调一次 */
  onDone?: () => void
}

let open: AuthDialogRequest | null = null
const listeners = new Set<() => void>()

export function openAuthDialog(channel: AuthChannel, opts: Omit<AuthDialogRequest, 'channel'> = {}): void {
  open = { channel, ...opts }
  listeners.forEach(fn => fn())
}

export function closeAuthDialog(): void {
  open = null
  listeners.forEach(fn => fn())
}

export function useAuthDialog(): AuthDialogRequest | null {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => open,
  )
}
