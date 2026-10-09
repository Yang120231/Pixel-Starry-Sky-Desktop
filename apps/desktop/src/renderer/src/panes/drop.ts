import { tr } from '../i18n/core'
// 拖放命中与尺寸检查：纯函数，拖动预览与提交使用相同规则。
import {
  computeRects,
  equalize,
  findLeaf,
  leafOfTab,
  leaves,
  moveTab,
  moveTabToEdge,
  parentSplit,
  type Edge,
  type Layout,
} from './tree'

export const MIN_PANE = { width: 400, height: 300 }
export type DropTarget = { leafId: string; index: number; edge?: never } | { leafId: string; edge: Edge; index?: never }
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export function edgeAt(box: Box, x: number, y: number): Edge | null {
  // 最近的边获胜，角落不会同时触发两条边；中央保留足够的合并区域。
  const hits: [Edge, number][] = [
    ['left', (x - box.x) / Math.min(72, box.width * 0.2)],
    ['right', (box.x + box.width - x) / Math.min(72, box.width * 0.2)],
    ['top', (y - box.y) / Math.min(72, box.height * 0.2)],
    ['bottom', (box.y + box.height - y) / Math.min(72, box.height * 0.2)],
  ]
  if (box.width <= 0 || box.height <= 0 || hits.some(([, distance]) => distance < 0)) return null
  const nearest = hits.sort((a, b) => a[1] - b[1])[0]
  return nearest[1] <= 1 ? nearest[0] : null
}

export function dropLayout(
  layout: Layout,
  tab: string,
  target: DropTarget,
  leafId: string,
  splitId: string,
  area?: { width: number; height: number },
): Layout {
  const next = target.edge
    ? moveTabToEdge(layout, tab, target.leafId, target.edge, leafId, splitId)
    : moveTab(layout, tab, target.leafId, target.index)
  if (!target.edge || !area || next === layout) return next
  const fits = (candidate: Layout, ids: string[]): boolean => {
    const panes = computeRects(candidate.root).panes
    return ids.every(id => {
      const r = panes.get(id)
      return r && r.w * area.width >= MIN_PANE.width && r.h * area.height >= MIN_PANE.height
    })
  }
  if (fits(next, [target.leafId, leafId])) return next
  // 两列加第三列时，均分同方向的相邻格；只有该组所有子窗格都放得下才采用。
  const parent = parentSplit(next.root, leafId)
  if (!parent) return next
  const balanced = equalize(next, parent.id)
  return fits(
    balanced,
    leaves(parent).map(l => l.id),
  )
    ? balanced
    : next
}

/** 先看移空源窗格后的最终尺寸；允许把两格的唯一会话重排，而非误判为再加一格。 */
export function dropProblem(
  layout: Layout,
  tab: string,
  target: DropTarget,
  area: { width: number; height: number },
): string | null {
  const source = leafOfTab(layout.root, tab)
  if (!source || !findLeaf(layout.root, target.leafId)) return tr('panes.drop.message556')
  if (!target.edge) return null
  if (source.id === target.leafId && source.tabs.length === 1) return tr('panes.drop.message557')
  const next = dropLayout(layout, tab, target, 'preview:leaf', 'preview:split', area)
  const panes = computeRects(next.root).panes
  for (const id of [target.leafId, 'preview:leaf']) {
    const rect = panes.get(id)
    if (!rect || rect.w * area.width < MIN_PANE.width || rect.h * area.height < MIN_PANE.height) {
      return tr('panes.drop.message558')
    }
  }
  return null
}
