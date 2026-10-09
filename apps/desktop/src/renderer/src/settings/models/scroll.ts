// 从输入框菜单的「管理模型…」打开设置时，滚到「菜单里显示的模型」（docs/ui/source-switch.md §8）
let pending = false

export function requestModelsScroll(): void {
  pending = true
}

/** 读一次就清掉 */
export function takeModelsScroll(): boolean {
  const p = pending
  pending = false
  return p
}
