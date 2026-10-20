// 会话快照的摘要：「待处理」、看板、底部胶囊只要等你批准的请求和最新的待办清单（docs/perf-audit-2026-10-18.md B3）。
// 原来它们订阅整个 snapshots，任何会话每输出一个字就重算、返回新数组，侧栏、看板跟着每帧整块重渲。
// 这里在 React 外面算：快照换了才重算，每个会话的 pending、最新待办都没变就沿用上次的对象，整份都没变就沿用上次的整份
import type { Item, SessionSnapshot } from '@pixelsky/protocol'

export type TodoItem = Extract<Item, { kind: 'todo' }>
export interface SessionDigest {
  pending: SessionSnapshot['pending']
  /** 最新的待办清单；没有为 null */
  todo: TodoItem | null
}

/** 每个会话上次找待办时看到的条目数组、长度和找到的位置：输出增量只换最后几条，不用每次从头找 */
interface TodoScan {
  items: readonly Item[]
  length: number
  index: number
}

const scans = new WeakMap<SessionSnapshot, TodoScan>()
let lastScans = new Map<string, TodoScan>()

/** 最新待办：条目数组换了时，只看上次长度往后的新条目，以及上次找到的那条有没有被换掉 */
export function latestTodo(items: readonly Item[], previous: TodoScan | undefined): TodoScan {
  if (previous && previous.items === items) return previous
  if (previous && items.length >= previous.length) {
    const kept = previous.index >= 0 ? items[previous.index] : undefined
    // 上次找到的还在原位（内容可能更新了，id 一样）：从上次的末尾往后看有没有更新的
    if (previous.index < 0 || (kept?.kind === 'todo' && kept.id === (previous.items[previous.index] as TodoItem).id)) {
      let index = previous.index
      for (let i = Math.max(previous.length - 1, 0); i < items.length; i++) if (items[i].kind === 'todo') index = i
      return { items, length: items.length, index }
    }
  }
  // 变短了（回退、换了会话）或对不上：从头找
  let index = -1
  for (let i = items.length - 1; i >= 0; i--)
    if (items[i].kind === 'todo') {
      index = i
      break
    }
  return { items, length: items.length, index }
}

let lastSnapshots: Readonly<Record<string, SessionSnapshot>> | null = null
let lastDigests: Readonly<Record<string, SessionDigest>> = {}

export function digestsOf(
  snapshots: Readonly<Record<string, SessionSnapshot>>,
): Readonly<Record<string, SessionDigest>> {
  if (snapshots === lastSnapshots) return lastDigests
  lastSnapshots = snapshots
  const next: Record<string, SessionDigest> = {}
  const nextScans = new Map<string, TodoScan>()
  let changed = Object.keys(lastDigests).length !== Object.keys(snapshots).length
  for (const [id, snapshot] of Object.entries(snapshots)) {
    const scan = scans.get(snapshot) ?? latestTodo(snapshot.items, lastScans.get(id))
    scans.set(snapshot, scan)
    nextScans.set(id, scan)
    const todo = scan.index >= 0 ? (snapshot.items[scan.index] as TodoItem) : null
    const prev = lastDigests[id]
    if (prev && prev.pending === snapshot.pending && prev.todo === todo) next[id] = prev
    else {
      next[id] = { pending: snapshot.pending, todo }
      changed = true
    }
  }
  lastScans = nextScans
  if (changed) lastDigests = next
  return lastDigests
}
