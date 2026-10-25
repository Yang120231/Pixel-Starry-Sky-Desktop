// 批量归档旧会话的纯逻辑（docs/ui/archive-old-sessions.md）：谁是候选、谁不能归档、时间怎么写。

export const DAY_MS = 86_400_000
export const PRESET_DAYS = [7, 14, 30] as const
export const DEFAULT_DAYS = 14
/** 自定义天数的上限：十年，再大没有意义 */
export const MAX_DAYS = 3650

/** 归档时主进程报「会话正在运行」 */
export const isRunningError = (message: string): boolean => message.includes('SESSION_RUNNING')

export type SkipReason = 'pinned' | 'running' | 'open' | 'channel'

export interface ArchiveItem {
  id: string
  title: string
  projectId: string
  projectName: string
  /** 最后一次收发消息的时间（SessionRecord.updatedAt，改名 / 置顶这类元数据改动不动它） */
  lastActive: number
  pinned: boolean
  running: boolean
  /** 任一窗格里开着 */
  open: boolean
  /** 加入了频道，或是频道开出来的 */
  channel: boolean
}

export interface ArchivePlan {
  /** 会归档的，最久没动的在前 */
  pick: ArchiveItem[]
  /** 到了天数但不能归档的，附原因 */
  skip: Array<{ item: ArchiveItem; reason: SkipReason }>
}

/** 不能归档的原因，按这个顺序取第一个 */
export function skipReason(item: ArchiveItem): SkipReason | null {
  if (item.pinned) return 'pinned'
  if (item.running) return 'running'
  if (item.open) return 'open'
  if (item.channel) return 'channel'
  return null
}

/** 超过 days 天没动过的会话，按「能归档 / 不能归档」分开；projectId 为 null 是全部项目 */
export function planArchive(
  items: readonly ArchiveItem[],
  options: { days: number; projectId: string | null; now: number },
): ArchivePlan {
  const cutoff = options.now - options.days * DAY_MS
  const old = items
    .filter(i => i.lastActive < cutoff && (options.projectId === null || i.projectId === options.projectId))
    .sort((a, b) => a.lastActive - b.lastActive)
  const plan: ArchivePlan = { pick: [], skip: [] }
  for (const item of old) {
    const reason = skipReason(item)
    if (reason) plan.skip.push({ item, reason })
    else plan.pick.push(item)
  }
  return plan
}

/** 自定义天数输入：1 到 MAX_DAYS 的整数，其余为 null */
export function parseDays(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null
  const n = Number(text)
  return n >= 1 && n <= MAX_DAYS ? n : null
}

/** 「N 天前 / N 周前 / N 个月前」：返回词典键和数字 */
export function idleLabel(
  lastActive: number,
  now: number,
): { key: 'archiveOld.ago.d' | 'archiveOld.ago.w' | 'archiveOld.ago.m'; n: number } {
  const days = Math.max(0, Math.floor((now - lastActive) / DAY_MS))
  if (days < 14) return { key: 'archiveOld.ago.d', n: days }
  if (days < 60) return { key: 'archiveOld.ago.w', n: Math.floor(days / 7) }
  return { key: 'archiveOld.ago.m', n: Math.floor(days / 30) }
}
