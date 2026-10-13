// 没在用的会话快照什么时候从界面内存里释放（docs/ui/renderer-memory.md §3.4，D123）：纯函数。
// 引用归零的会话进「最近释放」队列，只留最近 keep 个；运行中 / 等你处理 / 正在打开的不释放也不占名额；归档且没人用的直接释放。

/** 引用归零后最多保留几个快照 */
export const RETAIN_RELEASED = 3

export interface RetentionInput {
  /** 现在有快照的会话 */
  loaded: readonly string[]
  /** 各会话被几处在用（useSession） */
  refs: ReadonlyMap<string, number>
  /** 引用归零的先后，最近的在后 */
  released: readonly string[]
  /** 不能释放的：运行中、等你处理、正在打开 */
  pinned: ReadonlySet<string>
  /** 已归档的 */
  archived: ReadonlySet<string>
  keep: number
}

/** 该释放哪些会话的快照 */
export function evictions({ loaded, refs, released, pinned, archived, keep }: RetentionInput): string[] {
  const idle = loaded.filter(id => !(refs.get(id) ?? 0) && !pinned.has(id))
  const gone = idle.filter(id => archived.has(id))
  // 没有释放记录的（后台预读拉来的）排在最前，最先释放
  const rest = idle.filter(id => !archived.has(id)).sort((a, b) => released.lastIndexOf(a) - released.lastIndexOf(b))
  return [...gone, ...rest.slice(0, Math.max(0, rest.length - Math.max(0, keep)))]
}
