// 主区当前显示的页面（docs/ui/channels.md §2；任务看板 docs/ui/task-board.md §2）。只存在内存里，每次启动都是工作台。
import { useSyncExternalStore } from 'react'

export type Page = 'workbench' | 'channels' | 'board'

let page: Page = 'workbench'
const listeners = new Set<() => void>()

export const getPage = (): Page => page

export function setPage(next: Page): void {
  if (next === page) return
  page = next
  for (const listener of listeners) listener()
}

/** 打开会话、文件、终端等工作台内容前调用：在频道页时切回工作台 */
export const showWorkbench = (): void => setPage('workbench')

export function subscribePage(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePage(): Page {
  return useSyncExternalStore(subscribePage, getPage)
}
