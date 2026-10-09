// 账号登录与额度：主进程、预加载脚本、渲染进程共用的类型。规格见 docs/ui/account.md §4

import type { AccountState } from '../shared/types/account'

/** window.pixelsky.account：所有网络请求都在主进程里做，渲染进程只能通过这里 */
export interface AccountBridge {
  listCalls(query: import('@pixelsky/protocol').RemoteCallsQuery): Promise<import('@pixelsky/protocol').RemoteCallPage>
  getState(): Promise<AccountState>
  /** 打开浏览器授权；状态变成 signing-in，完成后变成 signed-in 或带 error 的 signed-out */
  login(): Promise<void>
  cancelLogin(): Promise<void>
  logout(): Promise<void>
  /** 重新拉取账号与额度 */
  refresh(): Promise<void>
  /** 订阅状态变化，返回取消订阅函数 */
  onChange(cb: (state: AccountState) => void): () => void
}
