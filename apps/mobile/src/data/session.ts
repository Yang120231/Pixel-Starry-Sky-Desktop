// 一个会话在手机上的状态：快照 + 按 seq 应用的事件（和桌面渲染层 features/engine/store 的做法一样）。
// 纯函数部分在这里测试（session.test.ts），React 钩子在 hooks.ts。
import { reduce, type EngineEvent, type Item, type SessionSnapshot } from '@pixelsky/protocol'

export interface SessionView {
  snapshot: SessionSnapshot | null
  seq: number
  /** 还有更早的条目时，向上翻页用的 id */
  before: string | null
  /** 被截断过的条目（显示「查看完整」） */
  truncated: string[]
  /** 快照还没到时先存下来的事件 */
  buffer: { seq: number; event: EngineEvent }[]
  /** seq 接不上（断线、电脑重启）：要重新打开 */
  stale: boolean
}

export const emptyView = (): SessionView => ({
  snapshot: null,
  seq: 0,
  before: null,
  truncated: [],
  buffer: [],
  stale: false,
})

export interface Tail {
  snapshot: SessionSnapshot
  seq: number
  before: string | null
  truncated: string[]
}

function applyOne(view: SessionView, seq: number, event: EngineEvent): SessionView {
  if (seq <= view.seq) return view
  if (seq !== view.seq + 1) return { ...view, stale: true }
  return { ...view, seq, snapshot: reduce(view.snapshot!, event) }
}

/** 收到会话事件 */
export function applyEvent(view: SessionView, seq: number, event: EngineEvent): SessionView {
  if (!view.snapshot) return { ...view, buffer: [...view.buffer, { seq, event }] }
  if (view.stale) return view
  return applyOne(view, seq, event)
}

/** 快照到了：替换，再补上之前存下的、seq 更大的事件 */
export function applyTail(view: SessionView, tail: Tail): SessionView {
  let next: SessionView = {
    snapshot: tail.snapshot,
    seq: tail.seq,
    before: tail.before,
    truncated: tail.truncated,
    buffer: [],
    stale: false,
  }
  for (const b of [...view.buffer].sort((a, c) => a.seq - c.seq)) next = applyOne(next, b.seq, b.event)
  return next
}

/** 向上翻页：更早的条目接在前面（按 id 去重） */
export function prependOlder(view: SessionView, older: Tail): SessionView {
  if (!view.snapshot) return view
  const have = new Set(view.snapshot.items.map(i => i.id))
  const items = [...older.snapshot.items.filter(i => !have.has(i.id)), ...view.snapshot.items]
  return {
    ...view,
    snapshot: { ...view.snapshot, items },
    before: older.before,
    truncated: [...older.truncated, ...view.truncated],
  }
}

/** 点了「查看完整」：换成完整的那一条 */
export function replaceItem(view: SessionView, item: Item, truncated: boolean): SessionView {
  if (!view.snapshot) return view
  return {
    ...view,
    snapshot: { ...view.snapshot, items: view.snapshot.items.map(i => (i.id === item.id ? item : i)) },
    truncated: truncated ? view.truncated : view.truncated.filter(id => id !== item.id),
  }
}
