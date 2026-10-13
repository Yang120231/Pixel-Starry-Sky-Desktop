import { useEffect } from 'react'
import { OPEN_FILES_EVENT } from '@/features/files/store'
import { OPEN_RIGHT_WORKSPACE } from '@/features/panel/workspaceStore'
import { showWorkbench } from '@/features/layout/page'
import { codingLayout } from './layoutStore'
import { routeWorkspaceTool } from './routingModel'

/** 和 panel/EnvironmentPanel.tsx 的 OPEN_BROWSER 同值（不引那个大组件文件） */
const OPEN_BROWSER = 'pixelsky:open-browser'

/** 代码模式下接住对话模式靠 App 处理的事件，改成打开代码模式的栏；只在 CodingLayout 里挂载 */
export function useCodingRouting(): void {
  useEffect(() => {
    const on = (name: string, fn: (e: Event) => void): (() => void) => {
      window.addEventListener(name, fn)
      return () => window.removeEventListener(name, fn)
    }
    const offs = [
      on(OPEN_RIGHT_WORKSPACE, e => {
        const id = (e as CustomEvent<{ id?: unknown }>).detail?.id
        const route = typeof id === 'string' ? routeWorkspaceTool(id) : null
        if (route?.panel === 'left') codingLayout.showLeft(route.view)
        else if (route?.panel === 'right') codingLayout.showRight(route.view)
        else if (route?.panel === 'bottom') codingLayout.showBottom(route.tab)
        showWorkbench()
      }),
      on(OPEN_FILES_EVENT, () => {
        codingLayout.showLeft('files')
        showWorkbench()
      }),
      on('pixelsky:open-task', () => {
        codingLayout.showRight('tasks')
        showWorkbench()
      }),
      on(OPEN_BROWSER, () => {
        codingLayout.showRight('browser')
        showWorkbench()
      }),
      on('pixelsky:toggle-sidebar', () => codingLayout.toggle('left')),
      on('pixelsky:toggle-panel', () => codingLayout.toggle('right')),
    ]
    return () => offs.forEach(off => off())
  }, [])
}
