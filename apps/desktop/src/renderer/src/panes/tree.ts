// 多对话窗格的布局树（纯函数，不碰 React / DOM）。规格见 docs/ui/multi-pane.md
//
// 布局是一棵树：split 把一块区域横向（row，左右排）或纵向（col，上下排）分给几个子节点，
// sizes 是各子节点的占比（不要求加起来等于 1，按比例分）；leaf 是一个窗格，里面叠放若干标签。
// 标签 id：会话 id，或 `new:<n>`（还没发第一条消息的新会话，显示欢迎页）。

export type Dir = 'row' | 'col'
export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface Leaf {
  type: 'leaf'
  id: string
  tabs: string[]
  active: string | null
}

export interface Split {
  type: 'split'
  id: string
  dir: Dir
  children: PaneNode[]
  sizes: number[]
}

export type PaneNode = Leaf | Split

export interface Layout {
  root: PaneNode
  /** 当前窗格（leaf id） */
  focused: string
  /** 放大中的窗格；null 表示没放大 */
  maximized: string | null
}

/** 矩形，全部是 0~1 的比例（相对整个窗格区域） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  splitId: string
  /** 分隔线在 children[index] 和 children[index + 1] 之间 */
  index: number
  dir: Dir
  /** 分隔线所在 split 的矩形（拖动时换算像素用） */
  splitRect: Rect
  /** 分隔线的位置：row 时是 x，col 时是 y（比例） */
  at: number
}

export const NEW_TAB_PREFIX = 'new:'
export const FILE_TAB_PREFIX = 'file:'
export function fileTab(ref: { projectId?: string; sessionId?: string }, path: string): string {
  return FILE_TAB_PREFIX + encodeURIComponent(JSON.stringify([ref.projectId ? 'project' : 'session', ref.projectId ?? ref.sessionId, path.replaceAll('\\', '/')]))
}
export function parseFileTab(tab: string): { ref: { projectId: string; sessionId?: never } | { sessionId: string; projectId?: never }; path: string } | null {
  if (!tab.startsWith(FILE_TAB_PREFIX)) return null
  try {
    const [kind, id, path] = JSON.parse(decodeURIComponent(tab.slice(FILE_TAB_PREFIX.length)))
    if ((kind !== 'project' && kind !== 'session') || typeof id !== 'string' || !id || typeof path !== 'string' || !path || path.includes('\0')) return null
    return { ref: kind === 'project' ? { projectId: id } : { sessionId: id }, path }
  } catch { return null }
}
export const isFileTab = (tab: string): boolean => parseFileTab(tab) !== null

export function isNewTab(tab: string): boolean {
  return tab.startsWith(NEW_TAB_PREFIX)
}

export function emptyLeaf(id: string): Leaf {
  return { type: 'leaf', id, tabs: [], active: null }
}

export function initialLayout(leafId: string, tab: string | null): Layout {
  const leaf = emptyLeaf(leafId)
  if (tab) {
    leaf.tabs = [tab]
    leaf.active = tab
  }
  return { root: leaf, focused: leafId, maximized: null }
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/** 所有窗格，按从左到右、从上到下的顺序 */
export function leaves(node: PaneNode): Leaf[] {
  return node.type === 'leaf' ? [node] : node.children.flatMap(leaves)
}

export function findLeaf(node: PaneNode, id: string): Leaf | null {
  return leaves(node).find((l) => l.id === id) ?? null
}

/** 标签在哪个窗格里；不在任何窗格里返回 null */
export function leafOfTab(node: PaneNode, tab: string): Leaf | null {
  return leaves(node).find((l) => l.tabs.includes(tab)) ?? null
}

/** 某个节点的父 split 和它在父节点里的位置 */
function parentOf(node: PaneNode, id: string): { parent: Split; index: number } | null {
  if (node.type === 'leaf') return null
  const index = node.children.findIndex((c) => c.id === id)
  if (index >= 0) return { parent: node, index }
  for (const c of node.children) {
    const hit = parentOf(c, id)
    if (hit) return hit
  }
  return null
}

/** 节点所在的父 split（拆分动画第二步用） */
export function parentSplit(node: PaneNode, id: string): Split | null {
  return parentOf(node, id)?.parent ?? null
}

/** 当前窗格正在显示的标签 */
export function focusedTab(layout: Layout): string | null {
  return findLeaf(layout.root, layout.focused)?.active ?? null
}

/** 所有窗格正在显示的标签（每个窗格一个） */
export function visibleTabs(layout: Layout): string[] {
  return leaves(layout.root)
    .map((l) => l.active)
    .filter((t): t is string => t !== null)
}

// ---------------------------------------------------------------------------
// 修改（全部返回新对象，不改原来的）
// ---------------------------------------------------------------------------

/** 替换树里某个节点；fn 返回 null 表示删除（由调用方保证随后整理） */
function mapNode(node: PaneNode, id: string, fn: (n: PaneNode) => PaneNode): PaneNode {
  if (node.id === id) return fn(node)
  if (node.type === 'leaf') return node
  return { ...node, children: node.children.map((c) => mapNode(c, id, fn)) }
}

function mapLeaf(layout: Layout, id: string, fn: (l: Leaf) => Leaf): Layout {
  return { ...layout, root: mapNode(layout.root, id, (n) => (n.type === 'leaf' ? fn(n) : n)) }
}

export function focusLeaf(layout: Layout, id: string): Layout {
  if (layout.focused === id || !findLeaf(layout.root, id)) return layout
  // 放大时切到别的窗格：先还原，否则看不见新的当前窗格
  return { ...layout, focused: id, maximized: layout.maximized && layout.maximized !== id ? null : layout.maximized }
}

/** 第 n 个窗格（从 0 开始）设为当前；不存在就不变 */
export function focusIndex(layout: Layout, n: number): Layout {
  const leaf = leaves(layout.root)[n]
  return leaf ? focusLeaf(layout, leaf.id) : layout
}

/** 按顺序切换到上一个 / 下一个窗格（首尾相连） */
export function cycleFocus(layout: Layout, delta: number): Layout {
  const all = leaves(layout.root)
  if (all.length < 2) return layout
  const i = all.findIndex((l) => l.id === layout.focused)
  return focusLeaf(layout, all[(i + delta + all.length) % all.length].id)
}

export function activateTab(layout: Layout, leafId: string, tab: string): Layout {
  return focusLeaf(
    mapLeaf(layout, leafId, (l) => (l.tabs.includes(tab) ? { ...l, active: tab } : l)),
    leafId,
  )
}

/**
 * 打开一个标签：已经在某个窗格里 → 切到那个窗格、那个标签；
 * 否则加到当前窗格（放在当前标签后面）并设为当前标签。
 */
export function openTab(layout: Layout, tab: string): Layout {
  const owner = leafOfTab(layout.root, tab)
  if (owner) return activateTab(layout, owner.id, tab)
  return mapLeaf(layout, layout.focused, (l) => {
    const at = l.active ? l.tabs.indexOf(l.active) + 1 : l.tabs.length
    return { ...l, tabs: [...l.tabs.slice(0, at), tab, ...l.tabs.slice(at)], active: tab }
  })
}

/** 把标签换成另一个 id（新会话发出第一条消息、有了真正的会话 id） */
export function replaceTab(layout: Layout, from: string, to: string): Layout {
  const owner = leafOfTab(layout.root, from)
  if (!owner) return layout
  // 目标已经在别的窗格里：去掉旧标签，切过去
  if (leafOfTab(layout.root, to)) return openTab(closeTab(layout, owner.id, from), to)
  return mapLeaf(layout, owner.id, (l) => ({
    ...l,
    tabs: l.tabs.map((t) => (t === from ? to : t)),
    active: l.active === from ? to : l.active,
  }))
}

/** 在窗格里按顺序切换标签（首尾相连） */
export function cycleTab(layout: Layout, leafId: string, delta: number): Layout {
  const leaf = findLeaf(layout.root, leafId)
  if (!leaf || leaf.tabs.length < 2 || !leaf.active) return layout
  const i = leaf.tabs.indexOf(leaf.active)
  return activateTab(layout, leafId, leaf.tabs[(i + delta + leaf.tabs.length) % leaf.tabs.length])
}

/** 关闭标签。当前标签关掉后显示右边的，没有就左边的。窗格空了也保留（关窗格用 removeLeaf） */
export function closeTab(layout: Layout, leafId: string, tab: string): Layout {
  return mapLeaf(layout, leafId, (l) => {
    const i = l.tabs.indexOf(tab)
    if (i < 0) return l
    const tabs = l.tabs.filter((t) => t !== tab)
    const active = l.active === tab ? (tabs[i] ?? tabs[i - 1] ?? null) : l.active
    return { ...l, tabs, active }
  })
}

/** index 是目标标签栏移除源标签前的插入缝；移动不复制标签，移空的源窗格立即合并。 */
export function moveTab(layout: Layout, tab: string, targetId: string, index: number): Layout {
  const source = leafOfTab(layout.root, tab)
  const target = findLeaf(layout.root, targetId)
  if (!source || !target || !Number.isFinite(index)) return layout
  let at = Math.max(0, Math.min(target.tabs.length, Math.trunc(index)))
  const from = source.tabs.indexOf(tab)
  if (source.id === target.id) {
    if (from < at) at--
    if (at === from) return activateTab(layout, targetId, tab)
    const tabs = source.tabs.filter(t => t !== tab)
    tabs.splice(at, 0, tab)
    return focusLeaf(mapLeaf(layout, targetId, leaf => ({ ...leaf, tabs, active: tab })), targetId)
  }
  let next = closeTab(layout, source.id, tab)
  next = mapLeaf(next, targetId, leaf => ({
    ...leaf, tabs: [...leaf.tabs.slice(0, at), tab, ...leaf.tabs.slice(at)], active: tab,
  }))
  if (source.tabs.length === 1) next = removeLeaf(next, source.id, targetId)
  return focusLeaf(next, targetId)
}

/** 移到目标窗格的某条边；自己的唯一标签不能拆成空窗格加原会话。 */
export function moveTabToEdge(layout: Layout, tab: string, targetId: string, edge: Edge, leafId: string, splitId: string): Layout {
  const source = leafOfTab(layout.root, tab)
  if (!source || !findLeaf(layout.root, targetId) || (source.id === targetId && source.tabs.length === 1)) return layout
  const dir = edge === 'left' || edge === 'right' ? 'row' : 'col'
  const before = edge === 'left' || edge === 'top'
  return moveTab(splitLeaf(layout, targetId, dir, leafId, splitId, before), tab, leafId, 0)
}

/**
 * 拆分窗格：在 leafId 的右边（row）或下面（col）放一个新的空窗格，并设为当前。
 * 父节点方向相同就直接插在它后面（平分它原来的占比），否则把它包成一个新 split。
 */
export function splitLeaf(layout: Layout, leafId: string, dir: Dir, newLeafId: string, newSplitId: string, before = false): Layout {
  if (!findLeaf(layout.root, leafId)) return layout
  const fresh = emptyLeaf(newLeafId)
  const hit = parentOf(layout.root, leafId)
  let root: PaneNode
  if (hit && hit.parent.dir === dir) {
    const { parent, index } = hit
    const half = parent.sizes[index] / 2
    const sizes = [...parent.sizes]
    sizes.splice(index, 1, half, half)
    const children = [...parent.children]
    children.splice(index + (before ? 0 : 1), 0, fresh)
    root = mapNode(layout.root, parent.id, () => ({ ...parent, children, sizes }))
  } else {
    root = mapNode(layout.root, leafId, (leaf) => ({
      type: 'split',
      id: newSplitId,
      dir,
      children: before ? [fresh, leaf] : [leaf, fresh],
      sizes: [1, 1],
    }))
  }
  return { root, focused: newLeafId, maximized: null }
}

/**
 * 拆分动画的起点：新窗格占比 0、它前面的兄弟占回原来的大小（视觉上和拆分前一样），
 * 下一帧再切到 splitLeaf 的结果，窗格就从 0 展开。
 */
export function splitStart(target: Layout, newLeafId: string, anchorId?: string): Layout {
  const hit = parentOf(target.root, newLeafId)
  if (!hit) return target
  const anchor = anchorId ? hit.parent.children.findIndex(c => c.id === anchorId) : hit.index > 0 ? hit.index - 1 : 1
  if (anchor < 0 || anchor === hit.index || anchor >= hit.parent.children.length) return target
  const sizes = [...hit.parent.sizes]
  sizes[anchor] += sizes[hit.index]
  sizes[hit.index] = 0
  return setSizes(target, hit.parent.id, sizes)
}

/** 设置某个 split 的占比 */
export function setSizes(layout: Layout, splitId: string, sizes: number[]): Layout {
  return {
    ...layout,
    root: mapNode(layout.root, splitId, (n) => (n.type === 'split' && n.children.length === sizes.length ? { ...n, sizes } : n)),
  }
}

/** 把某个子节点的占比设为 0（关闭动画的第一步：先收拢，再 removeLeaf） */
export function collapseLeaf(layout: Layout, leafId: string): Layout {
  const hit = parentOf(layout.root, leafId)
  if (!hit) return layout
  const sizes = hit.parent.sizes.map((s, i) => (i === hit.index ? 0 : s))
  return setSizes(layout, hit.parent.id, sizes)
}

/** 某个 split 里各子节点平分 */
export function equalize(layout: Layout, splitId: string): Layout {
  const root = mapNode(layout.root, splitId, (n) => (n.type === 'split' ? { ...n, sizes: n.children.map(() => 1) } : n))
  return { ...layout, root }
}

/**
 * 删除窗格：它的占比按比例分给兄弟节点；父 split 只剩一个子节点时用这个子节点替换父节点，
 * 子节点和祖父方向相同时再拍平。删掉最后一个窗格时留一个空窗格（id 用 fallbackId）。
 */
export function removeLeaf(layout: Layout, leafId: string, fallbackId: string): Layout {
  const all = leaves(layout.root)
  if (!all.some((l) => l.id === leafId)) return layout
  if (all.length === 1) return { root: emptyLeaf(fallbackId), focused: fallbackId, maximized: null }

  const order = all.findIndex((l) => l.id === leafId)
  const nextFocus = layout.focused === leafId ? (all[order - 1] ?? all[order + 1]).id : layout.focused
  const root = normalize(removeNode(layout.root, leafId)!)
  return { root, focused: nextFocus, maximized: layout.maximized === leafId ? null : layout.maximized }
}

function removeNode(node: PaneNode, id: string): PaneNode | null {
  if (node.id === id) return null
  if (node.type === 'leaf') return node
  const children: PaneNode[] = []
  const sizes: number[] = []
  node.children.forEach((c, i) => {
    const kept = removeNode(c, id)
    if (kept) {
      children.push(kept)
      sizes.push(node.sizes[i])
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  // 剩下的占比全是 0（关闭动画里收拢过）时平分，避免整块消失
  return { ...node, children, sizes: sizes.some((s) => s > 0) ? sizes : sizes.map(() => 1) }
}

/** 子 split 和父 split 方向相同时拍平成一层（占比按比例展开） */
function normalize(node: PaneNode): PaneNode {
  if (node.type === 'leaf') return node
  const children: PaneNode[] = []
  const sizes: number[] = []
  node.children.forEach((raw, i) => {
    const c = normalize(raw)
    if (c.type === 'split' && c.dir === node.dir) {
      const total = c.sizes.reduce((a, b) => a + b, 0) || 1
      c.children.forEach((cc, j) => {
        children.push(cc)
        sizes.push((node.sizes[i] * c.sizes[j]) / total)
      })
    } else {
      children.push(c)
      sizes.push(node.sizes[i])
    }
  })
  return { ...node, children, sizes }
}

export function toggleMaximize(layout: Layout, leafId: string): Layout {
  if (leaves(layout.root).length < 2) return { ...layout, maximized: null }
  return { ...layout, focused: leafId, maximized: layout.maximized === leafId ? null : leafId }
}

/** 去掉不该再显示的标签（例如会话已被删除） */
export function pruneTabs(layout: Layout, keep: (tab: string) => boolean): Layout {
  let next: Layout = layout
  for (const leaf of leaves(layout.root)) {
    for (const tab of leaf.tabs) if (!keep(tab)) next = closeTab(next, leaf.id, tab)
  }
  return next
}

// ---------------------------------------------------------------------------
// 几何：把树换算成每个窗格的矩形和分隔线
// ---------------------------------------------------------------------------

export function computeRects(node: PaneNode, rect: Rect = { x: 0, y: 0, w: 1, h: 1 }): { panes: Map<string, Rect>; dividers: Divider[] } {
  const panes = new Map<string, Rect>()
  const dividers: Divider[] = []
  const walk = (n: PaneNode, r: Rect): void => {
    if (n.type === 'leaf') {
      panes.set(n.id, r)
      return
    }
    const total = n.sizes.reduce((a, b) => a + b, 0) || 1
    let offset = 0
    n.children.forEach((c, i) => {
      const part = n.sizes[i] / total
      const childRect: Rect =
        n.dir === 'row'
          ? { x: r.x + offset * r.w, y: r.y, w: part * r.w, h: r.h }
          : { x: r.x, y: r.y + offset * r.h, w: r.w, h: part * r.h }
      offset += part
      walk(c, childRect)
      if (i < n.children.length - 1) {
        dividers.push({
          splitId: n.id,
          index: i,
          dir: n.dir,
          splitRect: r,
          at: n.dir === 'row' ? r.x + offset * r.w : r.y + offset * r.h,
        })
      }
    })
  }
  walk(node, rect)
  return { panes, dividers }
}

/** 找到 id 对应的 split（拖动分隔线时取当前占比） */
export function findSplit(node: PaneNode, id: string): Split | null {
  if (node.type === 'leaf') return null
  if (node.id === id) return node
  for (const c of node.children) {
    const hit = findSplit(c, id)
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------------------------
// 保存 / 读取
// ---------------------------------------------------------------------------

/** 从 localStorage 读出来的东西不可信：结构不对就返回 null，用默认布局 */
export function parseLayout(raw: unknown): Layout | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ids = new Set<string>()
  const node = (v: unknown): PaneNode | null => {
    if (!v || typeof v !== 'object') return null
    const n = v as Record<string, unknown>
    if (typeof n.id !== 'string' || ids.has(n.id)) return null
    ids.add(n.id)
    if (n.type === 'leaf') {
      const tabs = Array.isArray(n.tabs) ? n.tabs.filter((t): t is string => typeof t === 'string') : []
      const uniq = [...new Set(tabs)]
      const active = typeof n.active === 'string' && uniq.includes(n.active) ? n.active : (uniq[0] ?? null)
      return { type: 'leaf', id: n.id, tabs: uniq, active }
    }
    if (n.type === 'split' && (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.children) && Array.isArray(n.sizes)) {
      const children = n.children.map(node)
      if (children.length < 2 || children.some((c) => !c) || n.sizes.length !== children.length) return null
      const sizes = n.sizes.map((s) => (typeof s === 'number' && s > 0 && Number.isFinite(s) ? s : 1))
      return { type: 'split', id: n.id, dir: n.dir, children: children as PaneNode[], sizes }
    }
    return null
  }
  const root = node(o.root)
  if (!root) return null
  const all = leaves(root)
  const focused = typeof o.focused === 'string' && all.some((l) => l.id === o.focused) ? o.focused : all[0].id
  return { root, focused, maximized: null }
}
