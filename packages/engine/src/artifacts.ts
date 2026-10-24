// 产物面板的数据（docs/ui/artifacts-panel.md §5）：扫描工作区内会话的改文件记录，汇总成「变更」和「交付」。
// 写法同 search.ts：不创建运行时，有运行时就用内存里的条目，否则流式读 items.jsonl（同一条目以最后一版为准）。
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { setImmediate as yieldThread } from 'node:timers/promises'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import {
  deliveryType,
  type ArtifactDelivery,
  type ArtifactFile,
  type ArtifactQuery,
  type ArtifactResponse,
  type ArtifactTurn,
  type Item,
  type SessionRecord,
} from '@pixelsky/protocol'

export const ARTIFACT_LIMITS = { turns: 300, files: 3000, delivered: 300 }
const DAY = 86_400_000

export function artifactQuery(value: unknown, workspace: string): ArtifactQuery {
  const q = value as Partial<ArtifactQuery> | null
  if (
    !q ||
    !Number.isSafeInteger(q.requestId) ||
    q.requestId! < 1 ||
    typeof q.projectId !== 'string' ||
    !q.projectId ||
    q.projectId.length > 200
  )
    throw new Error('产物参数无效')
  const days = Number.isInteger(q.days) ? Math.min(30, Math.max(1, q.days!)) : 7
  return { requestId: q.requestId!, projectId: q.projectId, workspace, days }
}

const key = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path)
/** path 是否在 root 内（含 root 本身）；Windows 不区分大小写 */
export function within(root: string, path: string): boolean {
  const rel = relative(key(resolve(root)), key(resolve(path)))
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}
const localOf = (root: string, absolute: string): string | null =>
  within(root, absolute) ? relative(resolve(root), absolute).split(sep).join('/') : null

async function historyItems(file: string, signal?: AbortSignal): Promise<{ items: Item[]; partial: boolean }> {
  signal?.throwIfAborted()
  const byId = new Map<string, Item>()
  const stream = createReadStream(file, { encoding: 'utf8', signal })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let readError: NodeJS.ErrnoException | null = null
  stream.on('error', err => {
    readError = err
    lines.close()
  })
  let count = 0,
    partial = false
  try {
    for await (const line of lines) {
      signal?.throwIfAborted()
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line) as Item
        if (item && typeof item.id === 'string' && typeof item.kind === 'string') byId.set(item.id, item)
        else partial = true
      } catch {
        partial = true
      }
      if (++count % 128 === 0) await yieldThread()
    }
    signal?.throwIfAborted()
    if (readError && (readError as NodeJS.ErrnoException).code !== 'ENOENT') partial = true
    return { items: [...byId.values()], partial }
  } catch (err) {
    signal?.throwIfAborted()
    return { items: [...byId.values()], partial: partial || (err as NodeJS.ErrnoException).code !== 'ENOENT' }
  } finally {
    lines.close()
    stream.destroy()
  }
}

export interface ArtifactSource {
  dataDir: string
  records: SessionRecord[]
  /** 不创建运行时，只返回已存在快照的条目 */
  liveItems(id: string): readonly Item[] | undefined
}

interface Delivery extends ArtifactDelivery {
  deleted: boolean
}

/** 一个会话的条目 → 按轮分组的改动，以及交付候选（同时记录工作区外的文件） */
export function sessionArtifacts(
  record: SessionRecord,
  items: readonly Item[],
  workspace: string,
): { turns: ArtifactTurn[]; deliveries: Delivery[]; outside: string[] } {
  const turns: ArtifactTurn[] = [],
    deliveries: Delivery[] = [],
    outside: string[] = []
  let turn: ArtifactTurn & { byPath: Map<string, ArtifactFile> } = {
    sessionId: record.id,
    title: record.title,
    engine: record.engine,
    archived: !!record.archivedAt,
    userItemId: null,
    prompt: '',
    at: record.createdAt,
    files: [],
    byPath: new Map(),
  }
  const flush = () => {
    if (turn.byPath.size) turns.push({ ...turn, files: [...turn.byPath.values()] })
  }
  for (const item of items) {
    if (item.kind === 'user' && item.mode !== 'guidance') {
      flush()
      turn = {
        ...turn,
        userItemId: item.id,
        prompt: item.text.replace(/\s+/g, ' ').trim().slice(0, 80),
        at: item.createdAt || turn.at,
        files: [],
        byPath: new Map(),
      }
      continue
    }
    if (item.kind !== 'file_change' || item.status !== 'completed') continue
    for (const change of item.changes) {
      if (!change.path) continue
      // Claude 的路径相对会话工作目录（工作目录外是绝对路径）；Codex 可能直接给绝对路径
      const absolute = normalize(isAbsolute(change.path) ? change.path : resolve(record.cwd, change.path))
      const inside = within(workspace, absolute),
        local = localOf(workspace, absolute)
      if (inside) {
        const prior = turn.byPath.get(key(absolute))
        turn.byPath.set(
          key(absolute),
          prior
            ? {
                ...prior,
                added: prior.added + change.added,
                removed: prior.removed + change.removed,
                kind: change.kind === 'delete' ? 'delete' : prior.kind === 'add' ? 'add' : change.kind,
                itemId: item.id,
                itemIds: prior.itemIds.includes(item.id) ? prior.itemIds : [...prior.itemIds, item.id],
              }
            : {
                path: change.path,
                absolute,
                inside,
                local,
                kind: change.kind,
                added: change.added,
                removed: change.removed,
                itemId: item.id,
                itemIds: [item.id],
              },
        )
      } else outside.push(key(absolute))
      const type = deliveryType(absolute)
      if ((change.kind === 'add' && type) || (!inside && change.kind !== 'delete') || change.kind === 'delete') {
        deliveries.push({
          sessionId: record.id,
          itemId: item.id,
          title: record.title,
          path: change.path,
          absolute,
          inside,
          local,
          type: type ?? 'other',
          at: turn.at,
          exists: true,
          bytes: null,
          deleted: change.kind === 'delete',
        })
      }
    }
  }
  flush()
  return { turns, deliveries, outside }
}

/** 汇总这个项目、这个工作区内最近 days 天的改动和交付 */
export async function collectArtifacts(
  source: ArtifactSource,
  query: ArtifactQuery,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<ArtifactResponse> {
  signal?.throwIfAborted()
  const since = now - query.days * DAY
  const records = source.records
    .filter(r => r.projectId === query.projectId && within(query.workspace, r.cwd) && r.updatedAt >= since)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const turns: ArtifactTurn[] = []
  const deliveries = new Map<string, Delivery>()
  const outside = new Set<string>()
  let partial = false,
    index = 0
  const worker = async () => {
    while (index < records.length) {
      signal?.throwIfAborted()
      const record = records[index++]
      let items = source.liveItems(record.id)
      if (items === undefined) {
        const history = await historyItems(join(source.dataDir, 'sessions', record.id, 'items.jsonl'), signal)
        partial ||= history.partial
        items = source.liveItems(record.id) ?? history.items
      }
      const result = sessionArtifacts(record, items, query.workspace)
      for (const t of result.turns) if (t.at >= since) turns.push(t)
      for (const d of result.deliveries) {
        if (d.at < since && !d.deleted) continue
        const k = key(d.absolute),
          prior = deliveries.get(k)
        if (!prior || d.at >= prior.at) deliveries.set(k, d)
      }
      for (const o of result.outside) outside.add(o)
      await yieldThread()
    }
  }
  await Promise.all([worker(), worker()])
  signal?.throwIfAborted()
  turns.sort((a, b) => b.at - a.at)
  // 最后一次是删除的文件不算交付
  const delivered = [...deliveries.values()].filter(d => !d.deleted && d.at >= since).sort((a, b) => b.at - a.at)
  let fileCount = 0,
    truncated = turns.length > ARTIFACT_LIMITS.turns || delivered.length > ARTIFACT_LIMITS.delivered
  const keptTurns: ArtifactTurn[] = []
  for (const t of turns.slice(0, ARTIFACT_LIMITS.turns)) {
    if (fileCount >= ARTIFACT_LIMITS.files) {
      truncated = true
      break
    }
    const files = t.files.slice(0, ARTIFACT_LIMITS.files - fileCount)
    if (files.length < t.files.length) truncated = true
    fileCount += files.length
    keptTurns.push({ ...t, files })
  }
  const kept = delivered.slice(0, ARTIFACT_LIMITS.delivered)
  await Promise.all(
    kept.map(async d => {
      try {
        const info = await stat(d.absolute)
        d.exists = info.isFile()
        d.bytes = info.isFile() ? info.size : null
      } catch {
        d.exists = false
        d.bytes = null
      }
    }),
  )
  return {
    requestId: query.requestId,
    turns: keptTurns,
    delivered: kept.map(({ deleted: _deleted, ...d }) => d),
    outsideCount: outside.size,
    truncated,
    partial,
  }
}

/** 这个会话的改动记录里有没有出现过这个路径（读取、打开工作区外文件前的安全检查） */
export function recordedIn(record: SessionRecord, items: readonly Item[], absolute: string): boolean {
  const target = key(normalize(absolute))
  return items.some(
    item =>
      item.kind === 'file_change' &&
      item.status === 'completed' &&
      item.changes.some(
        c => c.path && key(normalize(isAbsolute(c.path) ? c.path : resolve(record.cwd, c.path))) === target,
      ),
  )
}

export { historyItems }
