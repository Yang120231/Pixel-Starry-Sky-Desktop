// 账号登录与额度：主进程、预加载脚本、渲染进程共用的类型。规格见 docs/ui/account.md §4

// 账号登录与额度：主进程、预加载脚本、渲染进程共用的类型。规格见 docs/ui/account.md §4

/** 额度：limit 为 0 表示不限 */
export interface Quota {
  used: number
  limit: number
}
export interface AccountPlan {
  name: string
  /** ISO 时间字符串；没有到期时间时为 null */
  expiresAt: string | null
  daily: Quota | null
  weekly: Quota | null
  monthly: Quota | null
}
export interface AccountInfo {
  email: string
  /** 显示名：sub2api 用户名，没有就用邮箱 @ 前面的部分 */
  name: string
  /** 钱包余额；拿不到时为 null */
  balance: number | null
  currency: string
  group: { name: string; billingSource: string } | null
  plan: AccountPlan | null
  rateLimits: Array<{ window: string; used: number; limit: number }>
  /** 上次成功拉取的时间（毫秒时间戳） */
  updatedAt: number
}
export type AccountState =
  | { status: 'signed-out'; error?: string }
  | { status: 'signing-in'; authCode: string }
  | { status: 'signed-in'; account: AccountInfo; refreshing: boolean; error?: string }
