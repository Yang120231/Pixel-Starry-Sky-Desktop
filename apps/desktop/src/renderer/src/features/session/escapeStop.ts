// 输入框里按 Esc 停止回复（docs/ui/conversation-ux.md §2.5）

export interface EscapeKey {
  key: string
  /** 输入法正在选字 */
  isComposing: boolean
  /** 别处已经处理过这次按键（例如智能体活动面板在捕获阶段拿去关自己） */
  defaultPrevented: boolean
}

/** 斜杠菜单开着时调用方先处理（Esc 关菜单），这里只看其余条件 */
export const escapeStops = (e: EscapeKey, running: boolean): boolean =>
  e.key === 'Escape' && running && !e.isComposing && !e.defaultPrevented
