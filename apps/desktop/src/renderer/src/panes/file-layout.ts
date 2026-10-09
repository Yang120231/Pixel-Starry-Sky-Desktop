import * as T from './tree'

export function openFileLayout(layout: T.Layout, tab: string, area: { width: number; height: number }, leafId: string, splitId: string): T.Layout {
  const existing = T.leafOfTab(layout.root, tab)
  if (existing) return T.activateTab(layout, existing.id, tab)
  const all = T.leaves(layout.root)
  const editor = all.find(l => l.tabs.some(T.isFileTab))
  if (editor) return T.openTab(T.focusLeaf(layout, editor.id), tab)
  if (all.length === 1 && area.width >= 800 && area.height >= 300) return T.openTab(T.splitLeaf(layout, all[0].id, 'row', leafId, splitId), tab)
  const empty = all.find(l => !l.tabs.length)
  return T.openTab(empty ? T.focusLeaf(layout, empty.id) : layout, tab)
}
