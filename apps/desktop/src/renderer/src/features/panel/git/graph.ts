// 提交历史的分支线（docs/ui/git-panel.md §9.4）：纯函数，按 --topo-order 的提交顺序给每行算车道和连线。
// 每个车道等着一个提交（它下面某个提交的父提交）；第一父提交沿用本车道，其他父提交另开车道，空出来的车道复用。

/** 当前分支上的提交和上游的关系（docs/ui/git-graph-colors.md）：未推送 / 已推送 / 远程新提交（未拉取）；别的分支没有 */
export type SyncState = 'local' | 'synced' | 'incoming'

export interface GraphCommit {
  hash: string
  parents: string[]
}

/** 一段连线，列号是车道。full：整行竖线；top：从上边的 from 列连到本行节点；bottom：从节点连到下边的 to 列 */
export interface GraphLine {
  kind: 'full' | 'top' | 'bottom'
  from: number
  to: number
  color: number
  /** 这段线属于哪种同步状态（没有就按 color 轮换）；分界行上边那段取下面那个提交的子提交的状态 */
  state?: SyncState
}

export interface GraphRow {
  lane: number
  color: number
  lines: GraphLine[]
  /** 这个提交的同步状态 */
  state?: SyncState
  /** 这一行要画的列数（含节点和所有连线） */
  width: number
  /** 合并提交（两个及以上父提交） */
  merge: boolean
}

/** 颜色轮换（参照 VS Code）：5 种 */
export const GRAPH_COLORS = 5

export function layoutGraph(commits: readonly GraphCommit[], states?: ReadonlyMap<string, SyncState>): GraphRow[] {
  /** 每个车道等着的提交；null 是空车道 */
  const lanes: (string | null)[] = []
  const colors: number[] = []
  /** 每个车道上正在往下走的线的状态（等着的那个提交的子提交的状态） */
  const laneStates: (SyncState | undefined)[] = []
  let nextColor = 0
  const open = (hash: string, avoid: number): number => {
    let i = lanes.findIndex((h, j) => h === null && j !== avoid)
    if (i < 0) i = lanes.length
    lanes[i] = hash
    colors[i] = nextColor++ % GRAPH_COLORS
    laneStates[i] = undefined
    return i
  }
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const incoming = lanes.flatMap((h, i) => (h === commit.hash ? [i] : []))
    // 没有子提交在等它（分支的最新提交）：开一条新车道
    const lane = incoming.length ? incoming[0] : open(commit.hash, -1)
    const color = colors[lane]
    const state = states?.get(commit.hash)
    const lines: GraphLine[] = []
    lanes.forEach((h, i) => {
      if (h === null || i === lane) return
      if (h === commit.hash) lines.push({ kind: 'top', from: i, to: lane, color: colors[i], state: laneStates[i] })
      else lines.push({ kind: 'full', from: i, to: i, color: colors[i], state: laneStates[i] })
    })
    if (incoming.length) lines.push({ kind: 'top', from: lane, to: lane, color, state: laneStates[lane] })
    // 汇进来的车道空出来
    for (const i of incoming.slice(1)) lanes[i] = null
    const [first, ...others] = commit.parents
    lanes[lane] = first ?? null
    // 本行往下的线用这个提交的状态：分界行上边是子提交的状态，下边是自己的
    laneStates[lane] = state
    if (first) lines.push({ kind: 'bottom', from: lane, to: lane, color, state })
    for (const parent of others) {
      const existing = lanes.indexOf(parent)
      const target = existing >= 0 ? existing : open(parent, lane)
      if (existing < 0) laneStates[target] = state
      lines.push({ kind: 'bottom', from: lane, to: target, color: colors[target], state })
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(lane, ...lines.map(l => Math.max(l.from, l.to))) + 1
    rows.push({ lane, color, lines, width, merge: commit.parents.length > 1, ...(state ? { state } : {}) })
  }
  return rows
}

/**
 * 插在某一行前面的特殊行（未拉取 / 未推送，§9.3）：穿过它的线都画成竖线，节点放在下一行节点的车道上，
 * 节点向下连到那一行（上面有线连进来时也从上面连下来）。
 */
export function spacerRow(next: GraphRow): GraphRow {
  const lines: GraphLine[] = []
  for (const line of next.lines) {
    if (line.kind === 'full') lines.push(line)
    else if (line.kind === 'top') {
      if (line.from === next.lane) lines.push({ ...line, from: next.lane, to: next.lane })
      else lines.push({ ...line, kind: 'full', to: line.from })
    }
  }
  lines.push({ kind: 'bottom', from: next.lane, to: next.lane, color: next.color, state: next.state })
  return { lane: next.lane, color: next.color, lines, width: next.width, merge: false, state: next.state }
}
