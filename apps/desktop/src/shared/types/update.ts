// 自动更新的状态：主进程（main/app/updater.ts）维护，推给「关于」页和侧栏提示

export type UpdateStatus =
  /** 开发模式：不检查 */
  | 'unsupported'
  /** 还没检查过 */
  | 'idle'
  | 'checking'
  /** 已是最新 */
  | 'latest'
  /** 便携版发现新版本：只能去下载页手动下载 */
  | 'available'
  /** 安装版发现新版本：后台下载中 */
  | 'downloading'
  /** 已下载，重启即可安装 */
  | 'ready'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** 运行方式：安装版自动下载，便携版只提示 */
  channel: 'dev' | 'portable' | 'installed'
  /** 要自己下载新版本（便携版、没签名的 macOS 版）：有新版只提示去下载 */
  manual?: boolean
  /** 是否接收测试版（预发布） */
  beta: boolean
  /** 新版本号（available / downloading / ready） */
  version?: string
  /** 更新说明（Release 页的文字，已转成纯文本） */
  notes?: string
  /** 下载进度 0–100 */
  percent?: number
  error?: string
  /** 上次检查完成的时间（毫秒） */
  checkedAt?: number
  /** 点了「重启以更新」、正在退出去安装：按钮显示「正在重启…」 */
  installing?: boolean
}
