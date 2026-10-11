// 系统托盘（docs/ui/tray.md）：主进程和窗口之间传的东西

/** 托盘菜单交给窗口去做的事 */
export type TrayCommand =
  | { kind: 'newTask' }
  | { kind: 'openSession'; sessionId: string }
  /** 勿扰到这个时间（毫秒时间戳）；null 结束勿扰 */
  | { kind: 'dnd'; until: number | null }
  /** 打开设置 › 关于并检查一次更新 */
  | { kind: 'checkUpdate' }

/** 主进程保存的窗口偏好（userData/window.json） */
export interface TrayPrefs {
  /** 关闭最后一个窗口时隐藏到托盘（任务继续），false 时退出 */
  closeToTray: boolean
}
