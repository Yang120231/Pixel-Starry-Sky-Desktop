// 「AI 这一轮改的」：从会话条目里取最近一轮已完成的文件改动，按路径合并（纯函数）
// 分轮规则照对话里的改动卡片（session/live/changeBlocks.ts）：不是引导、也不是断线重连「继续」的 user 条目开始新的一轮
import type { Item } from '@pixelsky/protocol'

export interface TurnFile {
  path: string
  name: string
  dir: string
  kind: 'add' | 'update' | 'delete'
  added: number
  removed: number
  diffs: string[]
}
export interface TurnChanges {
  turnKey: string
  running: boolean
  files: TurnFile[]
  added: number
  removed: number
}

type FileChangeItem = Extract<Item, { kind: 'file_change' }>

const slashes = (path: string): string => path.replaceAll('\\', '/')

/** 路径相对项目根；根目录之外的、或本来就是相对路径的原样返回（斜杠统一成 /，去掉开头的 ./） */
export function relativePath(root: string, path: string, caseInsensitive: boolean): string {
  const p = slashes(path)
  const base = slashes(root).replace(/\/+$/, '')
  if (base) {
    const head = p.slice(0, base.length + 1),
      want = base + '/'
    if (caseInsensitive ? head.toLowerCase() === want.toLowerCase() : head === want) return p.slice(want.length)
  }
  return p.replace(/^\.\//, '')
}

const isTurnUser = (item: Item): boolean =>
  item.kind === 'user' && item.mode !== 'guidance' && item.reconnect === undefined
const completedChange = (item: Item): item is FileChangeItem =>
  item.kind === 'file_change' && item.status === 'completed'

/** 最近一轮（往前找第一轮有已完成改动的）的改动；没有时 null */
export function latestTurnChanges(
  items: readonly Item[],
  running: boolean,
  root: string,
  caseInsensitive: boolean,
): TurnChanges | null {
  // 分轮：turnKey 是开启这一轮的 user 条目 id，第一条 user 之前的为 'start'
  const turns: Array<{ key: string; changes: FileChangeItem[] }> = []
  let current: { key: string; changes: FileChangeItem[] } | null = null
  for (const item of items) {
    if (isTurnUser(item)) {
      current = { key: item.id, changes: [] }
      turns.push(current)
    } else if (completedChange(item)) {
      if (!current) {
        current = { key: 'start', changes: [] }
        turns.push(current)
      }
      current.changes.push(item)
    }
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (!turn.changes.length) continue
    const byPath = new Map<string, TurnFile & { first: TurnFile['kind']; last: TurnFile['kind'] }>()
    for (const item of turn.changes) {
      for (const c of item.changes) {
        const path = relativePath(root, c.path, caseInsensitive)
        const key = caseInsensitive ? path.toLowerCase() : path
        let file = byPath.get(key)
        if (!file) {
          const cut = path.lastIndexOf('/')
          file = {
            path,
            name: cut >= 0 ? path.slice(cut + 1) : path,
            dir: cut >= 0 ? path.slice(0, cut + 1) : '',
            kind: 'update',
            added: 0,
            removed: 0,
            diffs: [],
            first: c.kind,
            last: c.kind,
          }
          byPath.set(key, file)
        }
        file.added += c.added
        file.removed += c.removed
        if (c.diff) file.diffs.push(c.diff)
        file.last = c.kind
      }
    }
    const files = [...byPath.values()].map(({ first, last, ...file }): TurnFile => {
      const kind: TurnFile['kind'] = last === 'delete' ? 'delete' : first === 'add' ? 'add' : 'update'
      return { ...file, kind }
    })
    return {
      turnKey: turn.key,
      running: i === turns.length - 1 && running,
      files,
      added: files.reduce((n, f) => n + f.added, 0),
      removed: files.reduce((n, f) => n + f.removed, 0),
    }
  }
  return null
}
