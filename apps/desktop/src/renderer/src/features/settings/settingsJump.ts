// 从别处打开设置后跳到某一行（例如额度弹窗的「额度按钮设置」）：先 request，设置弹窗打开后 take 一次，
// 再走它现有的滚动 + 高亮（SettingsDialog 的 jump）。写法照 models/scroll.ts。
let pending: string | null = null

/** title 是那一行的 data-setting-title（当前界面语言的标题） */
export function requestSettingsRow(title: string): void {
  pending = title
}

/** 读一次就清掉 */
export function takeSettingsRow(): string | null {
  const title = pending
  pending = null
  return title
}
