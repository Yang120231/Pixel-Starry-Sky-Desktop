import { useEffect, useRef } from 'react'

/**
 * 浮层、就地编辑框关掉后焦点掉到 body 时，还给打开前有焦点的元素（键盘用户不用从头 Tab）。
 * 关掉时焦点已经去了别处（点了别的输入框、新开的对话框）就不动
 */
export function useRestoreFocus(open: boolean): void {
  const prev = useRef<HTMLElement | null>(null)
  // 渲染时记：里面的 autoFocus 比 effect 先把焦点拿走
  if (open && !prev.current && typeof document !== 'undefined')
    prev.current = document.activeElement as HTMLElement | null
  useEffect(() => {
    if (!open) return
    return () => {
      const back = prev.current
      prev.current = null
      // 被动 effect 的清理在 DOM 移除之后：焦点原来在浮层里的这时已经落到 body
      const active = document.activeElement
      if (back?.isConnected && back !== document.body && (!active || active === document.body)) back.focus()
    }
  }, [open])
}
