import type { RightView } from '../types'

/** 右栏各视图：标题 key 和图标名（图标在组件里按名字取，这里保持纯数据） */
export type RightViewIcon = 'chat' | 'browser' | 'artifacts' | 'notifications' | 'tasks' | 'sandbox' | 'copies'

export interface RightViewMeta {
  view: RightView
  titleKey: `coding.right.view.${RightView}`
  icon: RightViewIcon
}

export const RIGHT_VIEW_ORDER: readonly RightView[] = [
  'chat',
  'browser',
  'artifacts',
  'notifications',
  'tasks',
  'sandbox',
  'copies',
]

const META: Record<RightView, RightViewMeta> = {
  chat: { view: 'chat', titleKey: 'coding.right.view.chat', icon: 'chat' },
  browser: { view: 'browser', titleKey: 'coding.right.view.browser', icon: 'browser' },
  artifacts: { view: 'artifacts', titleKey: 'coding.right.view.artifacts', icon: 'artifacts' },
  notifications: { view: 'notifications', titleKey: 'coding.right.view.notifications', icon: 'notifications' },
  tasks: { view: 'tasks', titleKey: 'coding.right.view.tasks', icon: 'tasks' },
  sandbox: { view: 'sandbox', titleKey: 'coding.right.view.sandbox', icon: 'sandbox' },
  copies: { view: 'copies', titleKey: 'coding.right.view.copies', icon: 'copies' },
}

/** 未知的值退回 chat */
export function resolveRightView(view: unknown): RightView {
  return typeof view === 'string' && Object.prototype.hasOwnProperty.call(META, view) ? (view as RightView) : 'chat'
}

export function rightViewMeta(view: unknown): RightViewMeta {
  return META[resolveRightView(view)]
}
