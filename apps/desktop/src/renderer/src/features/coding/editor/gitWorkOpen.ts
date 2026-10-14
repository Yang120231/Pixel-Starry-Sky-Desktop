// 样式 A（docs/ui/coding-mode.md §3.3.2）：工作区改动打开成中栏的文件标签。和 gitDiffTabs 分开放：
// 这里要用文件 store 和编辑器，gitDiffTabs 保持不碰它们（它的测试只替换了标签组）
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { openFile, useFiles } from '@/features/files/store'
import { refKey } from '@/features/editor/target'
import { setCodeView, useCodeTabs } from './codeTabs'
import { isGitDiffId } from './codeTabsModel'
import { gitPanelKey } from './gitDiffTabs'

/** 中栏当前是这个工作区（Git 面板的 key）的文件标签时，返回它相对工作区的路径（样式 A 下左栏高亮这一行）；否则 null */
export function useActiveCodeFile(key: string): string | null {
  const { group } = useCodeTabs()
  const files = useFiles()
  const id = group.active
  if (!id || isGitDiffId(id)) return null
  const tab = files.tabs.find(t => t.id === id)
  return tab && gitPanelKey(refKey(tab.ref)) === key ? tab.path : null
}

/** 打开到中栏的文件标签、切到「变更」对比 HEAD（样式 A） */
export async function openWorkFile(ref: WorkspaceRef, local: string): Promise<void> {
  const id = await openFile(ref, local, undefined, 1, undefined, { target: 'code' })
  if (id) setCodeView(id, 'diff', 'head')
}
