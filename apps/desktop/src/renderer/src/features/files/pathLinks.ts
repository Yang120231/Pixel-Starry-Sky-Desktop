// 文字里的路径 → 项目内确实存在的文件（终端 docs/ui/files-search-terminal-pins.md §4.2，对话 docs/ui/content-highlight.md §2 A）。
// 项目 / 会话的根目录（含附加文件夹）缓存 30 秒，目录列表缓存几秒：鼠标划过同一屏输出、一条回复里有很多路径时不会反复读盘。
import { machineOf } from '@/features/machines/store'
import type { WorkspaceRef, WorkspaceTarget } from '../../../../shared/types/workspace'
import { findPathMatches, projectPath } from './pathMatch'

const LIST_TTL = 5000
/** 项目的附加文件夹可能改（docs/ui/multi-root-projects.md §3），目标只缓存一会儿 */
const TARGET_TTL = 30_000
const targets = new Map<string, { at: number; target: Promise<WorkspaceTarget | null> }>()
const listings = new Map<string, { at: number; names: Promise<Set<string> | null> }>()

const refKey = (ref: WorkspaceRef): string => (ref.sessionId ? `s:${ref.sessionId}` : `p:${ref.projectId}`)

function workspaceTarget(ref: WorkspaceRef): Promise<WorkspaceTarget | null> {
  const key = refKey(ref),
    cached = targets.get(key)
  if (cached && Date.now() - cached.at < TARGET_TTL) return cached.target
  const target = window.pixelsky!.files.target(ref).catch(() => null)
  targets.set(key, { at: Date.now(), target })
  return target
}

/** 项目根目录（会话是会话的工作目录） */
export async function workspaceRoot(ref: WorkspaceRef): Promise<string | null> {
  return (await workspaceTarget(ref))?.path ?? null
}

function namesIn(ref: WorkspaceRef, dir: string, windows: boolean): Promise<Set<string> | null> {
  const key = refKey(ref) + '\0' + dir,
    cached = listings.get(key)
  if (cached && Date.now() - cached.at < LIST_TTL) return cached.names
  const names = window
    .pixelsky!.files.listExisting(ref, dir)
    .then(list =>
      list
        ? new Set(list.entries.filter(e => e.kind === 'file').map(e => (windows ? e.name.toLowerCase() : e.name)))
        : null,
    )
    .catch(() => null)
  listings.set(key, { at: Date.now(), names })
  if (listings.size > 200) listings.delete(listings.keys().next().value!)
  return names
}

/**
 * 一个路径 → 项目内存在的文件的相对路径；不存在、在项目外或解析不了时为 null。
 * cwd 是相对路径的起点，不给时用项目根目录。
 */
export async function workspaceFilePath(ref: WorkspaceRef, raw: string, cwd?: string): Promise<string | null> {
  if (!window.pixelsky) return null
  const windows = machineOf(ref.projectId ?? ref.sessionId) === 'local' && window.pixelsky.platform === 'win32'
  const target = await workspaceTarget(ref)
  if (!target) return null
  const root = target.path
  let relative = projectPath(raw, cwd ?? root, root, windows)
  // 多文件夹项目：不在主文件夹里的再看附加文件夹，换成「::N/…」
  if (!relative)
    for (const [i, folder] of (target.folders ?? []).entries()) {
      const inFolder = projectPath(raw, cwd ?? root, folder.path, windows)
      if (inFolder) {
        relative = `::${i + 1}/${inFolder}`
        break
      }
    }
  if (!relative) return null
  const parts = relative.split('/'),
    name = parts.pop()!
  const names = await namesIn(ref, parts.join('/'), windows)
  return names?.has(windows ? name.toLowerCase() : name) ? relative : null
}

export interface FileTarget {
  /** 相对项目根目录，用 / 分隔 */
  path: string
  line: number | null
  column: number | null
}

/**
 * 一整段文字（行内代码、@ 后面的路径）恰好是一个路径（可带 :行 / :行:列）时，解析成项目里存在的文件；
 * 文字里还有别的内容、或者文件不存在时为 null。
 */
export async function wholeTextFile(ref: WorkspaceRef, text: string): Promise<FileTarget | null> {
  const value = text.trim()
  const [match] = findPathMatches(value)
  if (!match || match.start !== 0 || match.end !== value.length) return null
  const path = await workspaceFilePath(ref, match.raw)
  return path ? { path, line: match.line, column: match.column } : null
}
