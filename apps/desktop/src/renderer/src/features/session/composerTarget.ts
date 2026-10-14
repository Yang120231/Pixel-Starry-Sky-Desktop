// 从编辑器等地方往会话输入框里放内容（docs/ui/editor-quote.md §2）：找哪个输入框、放完把光标移过去
import { composerInputFor } from './composerInput/ComposerInput'
import { isLive } from '@/features/engine'
import { getEngineState } from '@/features/engine/store'
import { getPaneState } from '@/features/panes/store'
import { focusedTab, isFileTab, visibleTabs } from '@/features/panes/tree'

export interface ComposerTarget {
  /** 输入框的草稿键（appendComposerDraft 用） */
  key: string
  /** 会话的工作目录；新任务还没开始时为 null */
  cwd: string | null
}

/** 当前焦点的会话输入框；焦点在文件标签上时找另一个能看到的会话。没有时为 null */
export function composerTarget(): ComposerTarget | null {
  const layout = getPaneState().layout
  const focused = focusedTab(layout)
  const tab = focused && !isFileTab(focused) ? focused : visibleTabs(layout).find(t => !isFileTab(t))
  if (!tab) return null
  const record = getEngineState().sessions.find(s => s.record.id === tab)?.record
  return { key: isLive ? tab : `demo:${tab}`, cwd: record?.cwd ?? null }
}

/** 把光标放到这个输入框的末尾（输入框要在页面上） */
export function focusComposer(key: string): void {
  // 等这次渲染把追加的草稿写进输入框
  requestAnimationFrame(() => composerInputFor(key)?.focusEnd())
}
