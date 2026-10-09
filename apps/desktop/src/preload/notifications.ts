// 系统通知（docs/ui/notifications.md）

import type { NotificationInput, NotificationClick } from '../shared/types/notifications'

export interface NotificationsBridge {
  supported: () => Promise<boolean>
  show: (input: NotificationInput) => Promise<boolean>
  onClick: (cb: (event: NotificationClick) => void) => () => void
}
