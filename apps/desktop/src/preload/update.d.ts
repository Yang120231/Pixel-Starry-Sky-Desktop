// 自动更新：主进程维护状态，「关于」页和侧栏提示读它（docs/release-update.md §7）

import type { UpdateState } from '../shared/types/update'

export interface UpdateBridge {
  state(): Promise<UpdateState>
  /** 立即检查（检查中 / 下载中 / 已下载时不重复检查），返回当时的状态 */
  check(): Promise<UpdateState>
  /** 已下载：退出并安装，装完自动重新打开 */
  install(): Promise<void>
  /** 便携版：在浏览器里打开新版本的下载页 */
  download(): Promise<void>
  /** 接收测试版开关，改了马上重新检查 */
  setBeta(beta: boolean): Promise<UpdateState>
  onChange(callback: (state: UpdateState) => void): () => void
}
