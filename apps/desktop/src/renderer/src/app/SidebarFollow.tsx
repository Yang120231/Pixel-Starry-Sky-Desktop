import { Component } from 'react'
import { motionEnabled } from '@/features/panes/motion'

/** 侧栏平移的时长和缓动（docs/ui/workbench.md §4.1 方案 B） */
const OPEN_MS = 260
const CLOSE_MS = 210
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** 会话里居中、要跟着侧栏平移的块；嵌在另一个目标里的不单独动 */
const TARGETS = '.conversation-reading, .composer-area, [data-follow-sidebar]'

interface Snapshot {
  /** 每个目标当前看到的中线（含还没播完的位移） */
  centers: Map<HTMLElement, number>
  /** 侧栏内容还在滑时相对格子左边的位移；没在滑时是 NaN */
  sideOffset: number
}

const running = new WeakMap<HTMLElement, Animation>()
let slides = 0

function sidebarSlot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-vt-chat-sidebar] > .collapsible-slot[data-slide]')
}

function targets(): HTMLElement[] {
  const surface = document.querySelector('.workbench-surface')
  if (!surface) return []
  const all = [...surface.querySelectorAll<HTMLElement>(TARGETS)].filter(el => el.getBoundingClientRect().width > 0)
  return all.filter(el => !all.some(other => other !== el && other.contains(el)))
}

function center(el: HTMLElement): number {
  const r = el.getBoundingClientRect()
  return r.left + r.width / 2
}

/** 动画期间根上标 data-sidebar-slide（滚动区不出横向滚动条），最后一个播完再去掉 */
function track(animation: Animation): void {
  slides++
  document.documentElement.dataset.sidebarSlide = ''
  // 播完的动画之后还可能被取消（再次开合时），finish 和 cancel 只算一次
  let ended = false
  const done = (): void => {
    if (ended) return
    ended = true
    if (--slides === 0) delete document.documentElement.dataset.sidebarSlide
  }
  animation.addEventListener('finish', done, { once: true })
  animation.addEventListener('cancel', done, { once: true })
}

function play(el: HTMLElement, from: number, to: number, duration: number): Animation {
  running.get(el)?.cancel()
  const animation = el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
    duration,
    easing: EASE,
  })
  running.set(el, animation)
  track(animation)
  return animation
}

/**
 * 对话模式侧边栏开合的平移动画（docs/ui/workbench.md §4.1）：侧栏格子宽度一步到位（CollapsibleSlot slide），
 * 这里在布局换之前量各块的位置（getSnapshotBeforeUpdate），换完后侧栏整块滑进 / 滑出、
 * 居中的块从旧位置平移到新位置（FLIP，只动 transform，不每帧重新排版）。
 */
export class SidebarFollow extends Component<{ open: boolean }> {
  override getSnapshotBeforeUpdate(prev: { open: boolean }): Snapshot | null {
    if (prev.open === this.props.open || !motionEnabled()) return null
    const slot = sidebarSlot()
    const inner = slot?.firstElementChild
    // 上一次还没滑完时从当前看到的位置接着滑；否则按开 / 关的起点算（收起后格子 0 宽，内容并没有位移）
    const sideOffset =
      slot && inner instanceof HTMLElement && running.get(inner)?.playState === 'running'
        ? inner.getBoundingClientRect().left - slot.getBoundingClientRect().left
        : NaN
    return { centers: new Map(targets().map(el => [el, center(el)])), sideOffset }
  }

  override componentDidUpdate(_prev: { open: boolean }, _state: unknown, snapshot: Snapshot | null): void {
    if (!snapshot) return
    const { open } = this.props
    const duration = open ? OPEN_MS : CLOSE_MS
    for (const [el, before] of snapshot.centers) {
      if (!el.isConnected) continue
      running.get(el)?.cancel()
      const dx = before - center(el)
      if (Math.abs(dx) >= 1) play(el, dx, 0, duration)
    }
    const slot = sidebarSlot()
    const inner = slot?.firstElementChild
    if (!slot || !(inner instanceof HTMLElement)) return
    const width = inner.offsetWidth
    const from = Number.isFinite(snapshot.sideOffset) ? snapshot.sideOffset : open ? -width : 0
    if (open) {
      delete slot.dataset.sliding
      play(inner, Math.min(0, from), 0, duration)
      return
    }
    // 收起：格子已经是 0 宽，先让内容浮在会话主区上面滑出去，滑完再裁掉
    slot.dataset.sliding = ''
    const animation = play(inner, Math.min(0, from), -width, duration)
    const clear = (): void => {
      if (running.get(inner) === animation) delete slot.dataset.sliding
    }
    animation.addEventListener('finish', clear, { once: true })
    animation.addEventListener('cancel', clear, { once: true })
  }

  override render(): null {
    return null
  }
}
