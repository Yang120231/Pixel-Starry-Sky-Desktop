// 授权弹窗开在哪条通道（docs/ui/model-channels.md §3）：输入框菜单、提示条、设置卡片都能打开，弹窗只挂一个（AuthDialogHost）
import { useSyncExternalStore } from 'react'
import type { AuthChannel } from './channelModel'

let open: AuthChannel | null = null
const listeners = new Set<() => void>()

export function openAuthDialog(channel: AuthChannel): void {
  open = channel
  listeners.forEach(fn => fn())
}

export function closeAuthDialog(): void {
  open = null
  listeners.forEach(fn => fn())
}

export function useAuthDialog(): AuthChannel | null {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => open,
  )
}
