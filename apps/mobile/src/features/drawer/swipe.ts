// 抽屉会话行左滑的判断（纯函数，SwipeRow 用）：方向锁、拖动范围、松手后停在哪

/** 左滑露出的操作区宽度：两个 75px 的按钮 */
export const ACTIONS_W = 150

/** 手指动了 10px 以上才定方向：横向（比竖向多）才算左滑，否则交给列表竖着滚；还没动够返回 null */
export function lockAxis(dx: number, dy: number): 'h' | 'v' | null {
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) return 'h'
  return Math.abs(dy) > 10 ? 'v' : null
}

/** 拖动时行的偏移：从 base（关着 0，开着 -ACTIONS_W）出发，只能在 [-ACTIONS_W, 0] 里 */
export const dragOffset = (base: number, dx: number): number => Math.min(0, Math.max(-ACTIONS_W, base + dx))

/** 松手时拖过一半就停在打开，否则收回 */
export const settlesOpen = (offset: number): boolean => offset <= -ACTIONS_W / 2
