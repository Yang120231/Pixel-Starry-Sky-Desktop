import type { BottomTab, LeftView, RightView } from './types'

export type ToolRoute =
  | { panel: 'left'; view: LeftView }
  | { panel: 'right'; view: RightView }
  | { panel: 'bottom'; tab: BottomTab }

const RIGHT_VIEWS: Record<string, RightView> = {
  artifacts: 'artifacts',
  browser: 'browser',
  tasks: 'tasks',
  sandbox: 'sandbox',
  copies: 'copies',
}

/** OPEN_RIGHT_WORKSPACE 的工具 id 在代码模式里落到哪一栏；文件标签（file:）和不认识的返回 null */
export function routeWorkspaceTool(id: string): ToolRoute | null {
  if (id.startsWith('file:')) return null
  if (id === 'terminal') return { panel: 'bottom', tab: 'terminal' }
  if (id === 'git') return { panel: 'left', view: 'git' }
  if (id === 'files') return { panel: 'left', view: 'files' }
  const right = Object.hasOwn(RIGHT_VIEWS, id) ? RIGHT_VIEWS[id] : undefined
  return right ? { panel: 'right', view: right } : null
}
