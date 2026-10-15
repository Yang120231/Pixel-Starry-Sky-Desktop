// 输入框模型菜单的排法（docs/ui/model-channels.md §2.3）：标签页（默认）/ 两栏，没设置的通道收进「＋」，
// 搜索跨通道，列表高度按最长的通道定。全是纯函数，界面在 session/ModelSourceMenu.tsx。
import type { EngineId } from '@pixelsky/protocol'
import type { ChannelGroupView, ChannelId, ChannelRow, ChannelState } from './channelModel'

export type MenuLayout = 'tabs' | 'cols'
export const MENU_LAYOUT_KEY = 'pixelsky.channels.menuLayout.v1'
/** 两栏的宽度；放不下时按标签页显示 */
export const COLS_MENU_WIDTH = 540
/** 一行模型的高度（px） */
export const MENU_ROW = 30
export const MENU_MIN_ROWS = 4
export const MENU_MAX_ROWS = 8

export function parseMenuLayout(raw: string | null): MenuLayout {
  try {
    return JSON.parse(raw ?? 'null') === 'cols' ? 'cols' : 'tabs'
  } catch {
    return 'tabs'
  }
}

/** 没设置：没登录像素星空、没授权、引擎没装、没加接口。这些通道不占标签 / 左栏，收进「＋」 */
export const isUnset = (s: ChannelState): boolean =>
  s.kind === 'signin' || s.kind === 'auth' || s.kind === 'missing' || s.kind === 'empty'

export interface MenuChannels {
  shown: ChannelGroupView[]
  unset: ChannelGroupView[]
}

/**
 * 分成显示的和收起的。已开始的对话正在用的通道即使失效了也照常显示（界面写原因和修复按钮），
 * 不然看不出这个对话为什么换不了；新任务没有这个例外
 */
export function splitChannels(
  groups: ChannelGroupView[],
  opts: { current: ChannelId; started: boolean },
): MenuChannels {
  const keep = (g: ChannelGroupView): boolean => !isUnset(g.state) || (opts.started && g.channel === opts.current)
  return { shown: groups.filter(keep), unset: groups.filter(g => !keep(g)) }
}

/** 显示着但失效了（只有上面那个例外会这样） */
export const isBroken = (g: ChannelGroupView): boolean => isUnset(g.state)

/** 一组里这个对话能选的行和跑不了的行（已开始的对话执行者固定，跑不了的收成一行） */
export function partitionRows(rows: ChannelRow[]): { usable: ChannelRow[]; blocked: ChannelRow[] } {
  return { usable: rows.filter(r => r.disabled !== 'locked'), blocked: rows.filter(r => r.disabled === 'locked') }
}

/** 跑不了的那几行要用谁跑：只有一种时给出它，混着的给 null */
export function blockedExecutor(rows: ChannelRow[]): EngineId | null {
  const set = new Set(rows.map(r => r.candidates[0]).filter(Boolean))
  return set.size === 1 ? [...set][0] : null
}

/** 打开时停在哪：上次看的还在就用它，否则当前通道，再否则第一个显示的，都没有就是添加页 */
export function resolveView(
  view: ChannelId | 'add' | null,
  channels: MenuChannels,
  current: ChannelId,
): ChannelId | 'add' {
  const keys = channels.shown.map(g => g.channel)
  if (view === 'add' && channels.unset.length) return 'add'
  if (view && view !== 'add' && keys.includes(view)) return view
  if (keys.includes(current)) return current
  return keys[0] ?? 'add'
}

/** ←/→ 换通道：显示的通道，加上有可添加的时最后的「＋」 */
export function stepView(view: ChannelId | 'add', channels: MenuChannels, dir: 1 | -1): ChannelId | 'add' {
  const keys: Array<ChannelId | 'add'> = [
    ...channels.shown.map(g => g.channel),
    ...(channels.unset.length ? ['add' as const] : []),
  ]
  if (!keys.length) return 'add'
  const i = keys.indexOf(view)
  return keys[(i + dir + keys.length) % keys.length]
}

/**
 * 列表区的行数：取所有显示的通道里最长的那个（切通道时菜单不跳、短列表也不留大片空白），夹在 4～8 行。
 * extra 是某一组额外的行（选中平台模型下面的线路、展开的自定义接口模型）
 */
export function listRows(channels: MenuChannels, extra: (g: ChannelGroupView) => number = () => 0): number {
  const rowsOf = (g: ChannelGroupView): number => {
    if (isBroken(g)) return 2
    if (g.state.kind !== 'ready') return 2
    const { usable, blocked } = partitionRows(g.rows)
    if (!usable.length && blocked.length) return 5
    return usable.length + (blocked.length ? 1 : 0) + (g.channel === 'platform' ? 1 : 0) + extra(g)
  }
  const counts = channels.shown.map(rowsOf)
  if (channels.unset.length) counts.push(Math.ceil(channels.unset.length * 1.7))
  return Math.max(MENU_MIN_ROWS, Math.min(MENU_MAX_ROWS, Math.max(0, ...counts)))
}

export interface SearchGroup {
  group: ChannelGroupView
  rows: ChannelRow[]
}

/**
 * 搜索全部显示的通道（失效的不搜）：text 给出一行用来匹配的文字（模型名、显示名、说明），不分大小写。
 * 跑不了的命中按通道数一下，界面汇总成一行
 */
export function searchChannels(
  channels: MenuChannels,
  query: string,
  text: (g: ChannelGroupView, row: ChannelRow) => string,
): { groups: SearchGroup[]; blocked: Array<{ channel: ChannelId; count: number }> } {
  const q = query.trim().toLowerCase()
  const live = channels.shown.filter(g => !isBroken(g) && g.state.kind === 'ready')
  const hit = (g: ChannelGroupView, r: ChannelRow): boolean => !q || text(g, r).toLowerCase().includes(q)
  return {
    groups: live
      .map(g => ({ group: g, rows: partitionRows(g.rows).usable.filter(r => hit(g, r)) }))
      .filter(x => x.rows.length),
    blocked: live
      .map(g => ({ channel: g.channel, count: partitionRows(g.rows).blocked.filter(r => hit(g, r)).length }))
      .filter(x => x.count),
  }
}

/** 搜索时高亮的那一段：[前, 命中, 后]；没命中返回 null */
export function highlightParts(text: string, query: string): [string, string, string] | null {
  const q = query.trim()
  if (!q) return null
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  return i < 0 ? null : [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)]
}
