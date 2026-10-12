// 额度来源的操作请求（docs/ui/source-switch.md §3.5）：对话流里错误卡片上的按钮发 window 事件，
// 由同一会话的输入框接住执行（打开模型菜单、切换额度来源要先确认，都由输入框负责）。
export const SOURCE_ACTION_EVENT = 'pixelsky:source-action'

/** retry：出错后一键接着做，往会话里发一条「继续」（和 Claude 桌面版的 Try again 一样） */
export type SourceAction =
  | 'open-menu'
  | 'use-self'
  | 'use-platform'
  | 'open-account'
  | 'sign-in'
  | 'edit-provider'
  | 'retry'

export function requestSourceAction(sessionId: string, action: SourceAction): void {
  window.dispatchEvent(new CustomEvent(SOURCE_ACTION_EVENT, { detail: { sessionId, action } }))
}
