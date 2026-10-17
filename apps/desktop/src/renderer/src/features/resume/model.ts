// 接着终端里的 Claude Code 会话：选择框的纯函数（合并、过滤、分组、预选、状态、模型选择、/resume 参数）。
// 写法照批量导入的 settings/projects/importModel.ts：判断都在这里，测试直接覆盖
import { replaceCodedErrors, type NativeSessionDetail, type NativeSessionSummary } from '@pixelsky/protocol'
import { groupsForModel, type CreditSource, type PlatformGroup } from '@/features/account/platform'

/** 会话 id 的格式（和引擎里 transcript.ts 的 UUID 同一个规则） */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 列表里的一行：第一步的摘要，加上第二步补的尾部信息；activeAt 只用来显示，排序始终按 updatedAt，补上时行不跳位 */
export type ResumeRow = NativeSessionSummary & { activeAt: number }

/** 第二步补上的信息并进第一步的列表；已经接到别的会话里的（superseded）不显示 */
export function mergeRows(
  rows: readonly NativeSessionSummary[],
  details: ReadonlyMap<string, NativeSessionDetail>,
): ResumeRow[] {
  return rows.flatMap<ResumeRow>(row => {
    const d = details.get(row.id)
    if (!d) return [{ ...row, activeAt: row.updatedAt }]
    if (d.superseded) return []
    // 预算用完的行（skipped）其余字段还是第一步的
    if (d.skipped) return [{ ...row, activeAt: row.updatedAt }]
    return [
      {
        ...row,
        title: d.title || row.title,
        lastPrompt: d.lastPrompt,
        model: d.model,
        branch: d.branch ?? row.branch,
        activeAt: d.lastActive ?? row.updatedAt,
      },
    ]
  })
}

/** 过滤：标题、最后一句、第一句、子文件夹、id 前缀，不区分大小写；空格隔开的几个词要同时命中 */
export function filterRows(rows: readonly ResumeRow[], keyword: string): ResumeRow[] {
  const terms = keyword.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return [...rows]
  return rows.filter(row => {
    const haystack = [row.title, row.lastPrompt ?? '', row.firstPrompt, row.subdir ?? ''].join('\n').toLowerCase()
    const id = row.id.toLowerCase()
    return terms.every(term => haystack.includes(term) || id.startsWith(term))
  })
}

export interface ResumeGroups {
  /** 没被占用的，从新到旧 */
  free: ResumeRow[]
  /** 已被像素星空的对话占用的（收在底部一组），同样从新到旧 */
  owned: ResumeRow[]
  /** 显示顺序：free 在前、owned 在后；键盘选中的下标就是它的下标，默认选中第一行 = 最近一个能接的 */
  all: ResumeRow[]
}

export function groupRows(rows: readonly ResumeRow[]): ResumeGroups {
  const byTime = (a: ResumeRow, b: ResumeRow): number => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  const free = rows.filter(r => !r.ownerId).sort(byTime)
  const owned = rows.filter(r => r.ownerId).sort(byTime)
  return { free, owned, all: [...free, ...owned] }
}

export type RowStatus = 'terminal' | 'other' | 'maybe' | null

/** 状态标签：登记里有进程开着按来源分两种；读不到登记、只看修改时间的是「可能还开着」 */
export const rowStatus = (row: Pick<NativeSessionSummary, 'live'>): RowStatus => row.live

/** 选中一行按 Enter 做什么：open 跳到已有的对话；copy 复制一份接着聊（正开着）；inplace 原地接着 */
export type RowAction = 'open' | 'copy' | 'inplace'

export function rowAction(row: Pick<NativeSessionSummary, 'ownerId' | 'live'>): RowAction {
  if (row.ownerId) return 'open'
  return row.live === 'terminal' || row.live === 'other' ? 'copy' : 'inplace'
}

/** 选中时行下面要不要展开选择：正开着、可能还开着的行 */
export const needsChoice = (row: Pick<NativeSessionSummary, 'ownerId' | 'live'>): boolean =>
  !row.ownerId && row.live !== null

export type NavKey = 'ArrowDown' | 'ArrowUp' | 'PageDown' | 'PageUp' | 'Home' | 'End'

/** 键盘移动选中行：上下循环，翻页不循环，Home / End 到头 / 到尾 */
export function moveSelection(index: number, key: NavKey, count: number, page = 8): number {
  if (count <= 0) return 0
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'PageDown':
      return Math.min(count - 1, index + page)
    case 'PageUp':
      return Math.max(0, index - page)
    case 'Home':
      return 0
    case 'End':
      return count - 1
  }
}

/** 手打的 `/resume` 或 `/resume 参数`：完整 uuid 直接打开，其他参数预填进搜索框；不是 /resume 返回 null */
export function parseResumeCommand(text: string): { id: string | null; query: string } | null {
  const match = /^\/resume(?:\s+([\s\S]+))?$/.exec(text.trim())
  if (!match) return null
  const args = (match[1] ?? '').trim()
  return UUID.test(args) ? { id: args.toLowerCase(), query: '' } : { id: null, query: args }
}

export interface ResumeModelInput {
  source: CreditSource
  /** 输入框现在的模型 / 分组 */
  model: string | null
  groupId: string | null
  /** 终端里这个会话最后用的模型（尾部才读得到，可能是 null；`<synthetic>` 不算） */
  sessionModel: string | null
  /** 平台：当前账号的全部线路 */
  groups: readonly PlatformGroup[]
  /** 自有额度：模型菜单里能选的模型 id（含引擎目录里的 id 和 resolved） */
  selfModels: readonly (string | null)[]
}

/**
 * 新对话用什么模型（docs/ui/claude-resume.md §0.1 F）：用会话最后用的模型，前提是当前额度来源能跑它——
 * 平台看有没有线路带这个模型（当前线路有就不换线路），自有额度看模型菜单里有没有，自定义接口一律用输入框的
 */
export function resumeModel(input: ResumeModelInput): { model: string | null; groupId: string | null } {
  const keep = { model: input.model, groupId: input.groupId }
  const want = input.sessionModel
  if (!want || want === '<synthetic>') return keep
  if (input.source === 'platform') {
    const groups = groupsForModel([...input.groups], want)
    if (!groups.length) return keep
    return { model: want, groupId: groups.find(g => g.id === input.groupId)?.id ?? groups[0].id }
  }
  if (input.source === 'self') return input.selfModels.includes(want) ? { model: want, groupId: null } : keep
  return keep
}

/** 「复制一份接着聊」只对原地导入的对话有用：没导入过的、已经是复制出来的都不给 */
export function canCopyImported(imported: { forked?: boolean } | null | undefined): boolean {
  return !!imported && !imported.forked
}

/** 发送失败的错误是不是「终端或别的程序正开着这个会话」（resume.live，QueuedMessage.error 可能带前缀） */
export function isResumeLiveError(error: string | null | undefined): boolean {
  let live = false
  replaceCodedErrors(error ?? '', info => {
    if (info.code === 'resume.live') live = true
    return ''
  })
  return live
}
