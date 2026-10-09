import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from './cn'

interface ResizeHandleProps {
  label: string
  axis: 'x' | 'y'
  value: number
  min: number
  max: number
  /** 居中输入框左右边缘的位移对应两倍宽度变化。 */
  scale?: number
  className?: string
  onChange(value: number): void
  onCommit(value: number): void
  onCancel?(): void
  onReset(): void
}

/** 指针捕获让鼠标离开拖动边后仍连续响应；Esc / pointercancel 撤回这次拖动。 */
export function ResizeHandle({ label, axis, value, min, max, scale = 1, className, onChange, onCommit, onCancel, onReset }: ResizeHandleProps) {
  useI18n()
  const [active, setActive] = useState(false)
  const drag = useRef<{ pointer: number; start: number; value: number; current: number; moved: boolean; restore?: () => void } | null>(null)
  const clamp = (v: number): number => Math.round(Math.max(min, Math.min(max, v)))
  const latest = useRef({ onChange, onCommit })
  latest.current = { onChange, onCommit }
  useEffect(() => () => {
    if (drag.current) {
      if (drag.current.moved) latest.current.onCommit(drag.current.current)
      delete document.documentElement.dataset.layoutResize
    }
  }, [])
  const finish = (cancel = false): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.moved) {
      if (cancel && d.restore) d.restore()
      else {
        const next = cancel ? d.value : d.current
        onChange(next)
        onCommit(next)
      }
    }
    setActive(false)
    delete document.documentElement.dataset.layoutResize
  }
  const down = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !e.isPrimary) return
    e.preventDefault(); e.stopPropagation()
    e.currentTarget.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointer: e.pointerId, start: axis === 'x' ? e.clientX : e.clientY, value, current: value, moved: false, restore: onCancel }
    document.documentElement.dataset.layoutResize = axis
    setActive(true)
  }
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    const point = axis === 'x' ? e.clientX : e.clientY
    const next = clamp(d.value + (point - d.start) * scale)
    if (next === d.current) return
    d.moved = true
    d.current = next
    onChange(d.current)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); finish(true); return }
    if (e.ctrlKey || e.altKey || e.metaKey) return // 保留窗格切换等全局组合键。
    let next: number
    const less = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const more = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === less || e.key === more) next = clamp(value + (e.key === less ? -1 : 1) * Math.sign(scale) * (e.shiftKey ? 32 : 8))
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onReset(); return }
    else return
    e.preventDefault(); e.stopPropagation(); onChange(next); onCommit(next)
  }
  return <div
    role="separator" tabIndex={0} aria-label={label} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)}
    title={tr("ui.ResizeHandle.message414", { p0: label })}
    className={cn('layout-resize-handle no-drag', axis === 'x' ? 'layout-resize-x' : 'layout-resize-y', className)}
    data-resizing={active || undefined}
    onPointerDown={down} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()}
    onDoubleClick={onReset} onKeyDown={key}
  />
}
