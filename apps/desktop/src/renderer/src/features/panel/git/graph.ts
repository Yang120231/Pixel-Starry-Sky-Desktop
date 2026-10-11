// 提交历史的分支线（docs/ui/git-panel.md §9.4）：纯函数，按 --topo-order 的提交顺序给每行算车道和连线。
// 每个车道等着一个提交（它下面某个提交的父提交）；第一父提交沿用本车道，其他父提交另开车道，空出来的车道复用。

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
}

export interface GraphRow {
  lane: number
  color: number
  lines: GraphLine[]
  /** 这一行要画的列数（含节点和所有连线） */
  width: number
  /** 合并提交（两个及以上父提交） */
  merge: boolean
}

/** 颜色轮换（参照 VS Code）：5 种 */
export const GRAPH_COLORS = 5

export function layoutGraph(commits: readonly GraphCommit[]): GraphRow[] {
  /** 每个车道等着的提交；null 是空车道 */
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  const open = (hash: string, avoid: number): number => {
    let i = lanes.findIndex((h, j) => h === null && j !== avoid)
    if (i < 0) i = lanes.length
    lanes[i] = hash
    colors[i] = nextColor++ % GRAPH_COLORS
    return i
  }
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const incoming = lanes.flatMap((h, i) => (h === commit.hash ? [i] : []))
    // 没有子提交在等它（分支的最新提交）：开一条新车道
    const lane = incoming.length ? incoming[0] : open(commit.hash, -1)
    const color = colors[lane]
    const lines: GraphLine[] = []
    lanes.forEach((h, i) => {
      if (h === null || i === lane) return
      if (h === commit.hash) lines.push({ kind: 'top', from: i, to: lane, color: colors[i] })
      else lines.push({ kind: 'full', from: i, to: i, color: colors[i] })
    })
    if (incoming.length) lines.push({ kind: 'top', from: lane, to: lane, color })
    // 汇进来的车道空出来
    for (const i of incoming.slice(1)) lanes[i] = null
    const [first, ...others] = commit.parents
    lanes[lane] = first ?? null
    if (first) lines.push({ kind: 'bottom', from: lane, to: lane, color })
    for (const parent of others) {
      const existing = lanes.indexOf(parent)
      const target = existing >= 0 ? existing : open(parent, lane)
      lines.push({ kind: 'bottom', from: lane, to: target, color: colors[target] })
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(lane, ...lines.map(l => Math.max(l.from, l.to))) + 1
    rows.push({ lane, color, lines, width, merge: commit.parents.length > 1 })
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
      if (line.from === next.lane) lines.push({ kind: 'top', from: next.lane, to: next.lane, color: line.color })
      else lines.push({ kind: 'full', from: line.from, to: line.from, color: line.color })
    }
  }
  lines.push({ kind: 'bottom', from: next.lane, to: next.lane, color: next.color })
  return { lane: next.lane, color: next.color, lines, width: next.width, merge: false }
}
