// 打开任务时焦点该落到哪（纯函数，openTask.ts 用；规则见那里的说明）
import { focusedTab, leaves, type Layout } from '@/features/panes/tree'

export type TaskTarget =
  | { kind: 'stay' }
  | { kind: 'tab'; leafId: string; tab: string }
  | { kind: 'session'; id: string }
  | { kind: 'new' }

/** 让焦点落到 projectId 上要怎么做；recent 是这个项目最近的会话（没有为 null） */
export function taskTarget(
  layout: Layout,
  projectOf: (tab: string) => string | null,
  projectId: string,
  recent: string | null,
): TaskTarget {
  const current = focusedTab(layout)
  if (current && projectOf(current) === projectId) return { kind: 'stay' }
  // 先看各窗格正在显示的标签，再看后面的标签
  const all = leaves(layout.root)
  for (const leaf of all)
    if (leaf.active && projectOf(leaf.active) === projectId) return { kind: 'tab', leafId: leaf.id, tab: leaf.active }
  for (const leaf of all)
    for (const tab of leaf.tabs) if (projectOf(tab) === projectId) return { kind: 'tab', leafId: leaf.id, tab }
  return recent ? { kind: 'session', id: recent } : { kind: 'new' }
}
