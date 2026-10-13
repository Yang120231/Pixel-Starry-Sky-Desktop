// 路径的点击约定（docs/ui/path-click.md §3）：单击打开，双击在文件夹中显示。
// 单击不等双击：onClick 只认 detail <= 1，第二下点击交给 onDoubleClick，所以不会重复打开、
// 改动卡片的对比也不会被开了又关。

interface PathMouseEvent {
  detail: number
  preventDefault(): void
}
interface PathKeyEvent {
  key: string
  shiftKey: boolean
  preventDefault(): void
}

export interface PathClickHandlers {
  onClick(e: PathMouseEvent): void
  onDoubleClick(e: PathMouseEvent): void
  onKeyDown(e: PathKeyEvent): void
  onMouseDown(e: PathMouseEvent): void
}

/** reveal 为 null（远程机器等不能在文件夹中显示）时只处理打开 */
export function pathClickHandlers({
  open,
  reveal,
}: {
  open: () => void
  reveal: (() => void) | null
}): PathClickHandlers {
  return {
    // 键盘触发的 click detail 是 0，也算单击
    onClick: e => {
      if (e.detail <= 1) open()
    },
    onDoubleClick: () => reveal?.(),
    onKeyDown: e => {
      if (e.key !== 'Enter') return
      // preventDefault：button / a 上的 Enter 本来会再触发一次 click，免得打开两次
      e.preventDefault()
      if (e.shiftKey) reveal?.()
      else open()
    },
    // 双击不把文字选中成一片蓝；单击拖选、复制路径照常
    onMouseDown: e => {
      if (e.detail > 1) e.preventDefault()
    },
  }
}
