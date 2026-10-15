import { useSyncExternalStore } from 'react'
import { onUiThemeChange, subscribePacks } from '@/features/extpacks/store'

// 编辑器相关的扩展状态变化：扩展包变了、界面深浅色变了、或颜色主题 / 片段自己加载完了。导入时没有副作用，第一个监听者来了才去订阅。
// colorTheme/ 和 snippets/ 不能通过这里订阅（它们自己会 notifyEditorPacksChanged，会死循环）：
// 它们直接订阅 subscribePacks、onUiThemeChange 和自己的选择变化。

const listeners = new Set<() => void>()
let detach: (() => void) | null = null
let tick = 0

function fire(): void {
  tick++
  for (const l of [...listeners]) l()
}

export function onEditorPacksChanged(listener: () => void): () => void {
  listeners.add(listener)
  if (!detach) {
    const offs = [subscribePacks(fire), onUiThemeChange(fire)]
    detach = () => offs.forEach(off => off())
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detach) {
      detach()
      detach = null
    }
  }
}

export function notifyEditorPacksChanged(): void {
  fire()
}

/** 每次 onEditorPacksChanged 触发就加一；对比视图把它放进重建的依赖里 */
export function useEditorPacksTick(): number {
  return useSyncExternalStore(
    onEditorPacksChanged,
    () => tick,
    () => tick,
  )
}
