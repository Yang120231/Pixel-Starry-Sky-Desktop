// 产物面板的纯函数（docs/ui/artifacts-panel.md）
import type { ArtifactTurn } from '@pixelsky/protocol'

export interface SessionGroup {
  sessionId: string
  title: string
  engine: ArtifactTurn['engine']
  archived: boolean
  at: number
  turns: ArtifactTurn[]
}

/** 变更按会话分组：会话按最近一轮的时间倒序，组内各轮也倒序 */
export function groupBySession(turns: readonly ArtifactTurn[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>()
  for (const turn of turns) {
    const g = groups.get(turn.sessionId) ?? {
      sessionId: turn.sessionId,
      title: turn.title,
      engine: turn.engine,
      archived: turn.archived,
      at: turn.at,
      turns: [],
    }
    g.turns.push(turn)
    g.at = Math.max(g.at, turn.at)
    groups.set(turn.sessionId, g)
  }
  for (const g of groups.values()) g.turns.sort((a, b) => b.at - a.at)
  return [...groups.values()].sort((a, b) => b.at - a.at)
}

/** 文件大小：1.2 KB / 3.4 MB */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`
}

/** 路径拆成文件名和目录（兼容 Windows 分隔符） */
export function splitArtifactPath(path: string): { name: string; dir: string } {
  const normal = path.replace(/\\/g, '/')
  const i = normal.lastIndexOf('/')
  return i < 0 ? { name: normal, dir: '' } : { name: normal.slice(i + 1), dir: normal.slice(0, i) }
}
