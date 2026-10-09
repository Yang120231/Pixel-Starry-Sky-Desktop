// 系统通知（docs/ui/notifications.md）

// 系统通知（docs/ui/notifications.md）
export interface NotificationInput {
  id: string
  title: string
  body: string
  sessionId: string | null
  /** 使用系统默认提示音 */
  sound: boolean
  /** 窗口不在前台时闪烁任务栏按钮 */
  attention: boolean
}
export interface NotificationClick {
  id: string
  sessionId: string | null
}
