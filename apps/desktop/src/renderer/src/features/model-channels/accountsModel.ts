// 账号表的纯计算（删除账号只在像素星空里生效，docs/ui/engine-accounts.md §5.1）：能不能删、删完换到哪个、哪些是重复的
import { DEFAULT_ACCOUNT, type EngineAccount, type EngineAccounts } from '@pixelsky/protocol'

/** 删掉 id 之后换到哪个账号：列表里第一个没失效的别的账号（和主进程的规则一样）；没有为 null（回到原来的账号） */
export function removeNext(list: Pick<EngineAccounts, 'accounts'>, id: string): EngineAccount | null {
  return list.accounts.find(a => a.id !== id && a.status !== 'expired') ?? null
}

/** 能不能删：列表里至少两项；原来的账号还要有别的可用账号（不然没有账号可用） */
export function canRemove(list: Pick<EngineAccounts, 'accounts'>, id: string): boolean {
  if (list.accounts.length < 2) return false
  return id !== DEFAULT_ACCOUNT || removeNext(list, id) !== null
}

/** 和列表里别的项邮箱相同（不分大小写）的账号 id：标「重复」 */
export function duplicateIds(list: Pick<EngineAccounts, 'accounts'>): Set<string> {
  const count = new Map<string, number>()
  for (const a of list.accounts)
    if (a.email) count.set(a.email.toLowerCase(), (count.get(a.email.toLowerCase()) ?? 0) + 1)
  return new Set(list.accounts.filter(a => a.email && (count.get(a.email.toLowerCase()) ?? 0) > 1).map(a => a.id))
}
