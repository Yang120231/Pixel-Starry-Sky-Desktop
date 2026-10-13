// 代码模式把 Ctrl+P 改成「左栏搜索」时，在这里登记覆盖函数；没有登记时 SearchProvider 照旧打开全局搜索弹窗
let override: (() => void) | null = null
export function setSearchShortcutOverride(handler: (() => void) | null): void {
  override = handler
}
export const getSearchShortcutOverride = (): (() => void) | null => override
