/** 盖在原生网页视图上的弹出层：只有会挡到网页视图的才需要把视图藏起来 */
export interface OverlayBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OverlayCandidate {
  rect: OverlayBox
  /** 设置对话框、aria-modal 对话框、全屏遮罩：不管位置，一律藏 */
  modal: boolean
}

/** 弹出层和占位框重叠时留的余量（像素） */
export const OVERLAY_MARGIN = 4

function overlaps(a: OverlayBox, b: OverlayBox, margin: number) {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width > b.x - margin &&
    a.y < b.y + b.height + margin &&
    a.y + a.height > b.y - margin
  )
}

/** 任意一个模态弹出层，或和占位框重叠的非模态弹出层，就要藏起网页视图；宽或高为 0 的不算 */
export function overlayHidesBrowser(
  placeholder: OverlayBox,
  candidates: readonly OverlayCandidate[],
  margin = OVERLAY_MARGIN,
): boolean {
  return candidates.some(c => {
    if (c.rect.width <= 0 || c.rect.height <= 0) return false
    return c.modal || overlaps(placeholder, c.rect, margin)
  })
}

const SELECTOR = '[role="dialog"],[role="menu"],[role="listbox"],[data-settings-dialog]'

/** 当前页面上看得见的弹出层（含是否模态）。不可见的（display:none、visibility:hidden、hidden、inert 收起的）不返回 */
export function collectOverlays(): { element: Element; candidate: OverlayCandidate }[] {
  const out: { element: Element; candidate: OverlayCandidate }[] = []
  for (const element of document.querySelectorAll(SELECTOR)) {
    if (element.closest('[hidden],[inert]')) continue
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const r = element.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    const fullScreen = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9
    const modal =
      element.hasAttribute('data-settings-dialog') || element.getAttribute('aria-modal') === 'true' || fullScreen
    out.push({ element, candidate: { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, modal } })
  }
  return out
}
