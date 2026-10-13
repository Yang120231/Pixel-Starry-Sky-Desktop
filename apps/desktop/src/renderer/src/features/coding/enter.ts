import { useEffect } from 'react'
import { demo, isDemo } from '@/data/demo'
import { paneActions, getPaneState } from '@/features/panes/store'
import { findLeaf, focusedTab, isFileTab, isNewTab } from '@/features/panes/tree'
import { CODING_DEMO_SESSION_ID } from './types'

/** 演示模式这次加载里是否已经自动打开过演示会话（D11） */
let demoEntered = false

/** 进入代码模式时的整理：焦点在文件标签上就换到同一窗格的会话标签；演示模式第一次进入打开演示会话 */
export function useEnterCodingMode(): void {
  useEffect(() => {
    const { layout } = getPaneState()
    const current = focusedTab(layout)
    if (current && isFileTab(current)) {
      const leaf = findLeaf(layout.root, layout.focused)
      const other = leaf?.tabs.find(t => !isFileTab(t) && !isNewTab(t)) ?? leaf?.tabs.find(t => !isFileTab(t))
      paneActions.open(other ?? null)
    }
    if (isDemo && !demoEntered) {
      demoEntered = true
      if (demo().conversations.snapshots[CODING_DEMO_SESSION_ID]) paneActions.open(CODING_DEMO_SESSION_ID)
    }
  }, [])
}

/** W0 桩留下的名字，W1-A 的 CodingLayout 可能还在用 */
export const useCodingEnter = useEnterCodingMode
