import type { TrayCommand, TrayPrefs } from '../shared/types/tray'

/** 系统托盘（docs/ui/tray.md） */
export interface TrayBridge {
  /** 托盘菜单让窗口做的事（新建任务、打开会话、切勿扰） */
  onCommand(callback: (command: TrayCommand) => void): () => void
  /** 告诉托盘现在的勿扰状态（菜单显示「勿扰 1 小时」还是「结束勿扰」） */
  reportDnd(until: number | null): void
  prefs(): Promise<TrayPrefs>
  setPrefs(patch: Partial<TrayPrefs>): Promise<TrayPrefs>
}
