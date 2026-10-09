// 终端路径链接要确认文件存在（docs/ui/files-search-terminal-pins.md §4.2）：项目根目录按项目缓存，
// 目录列表缓存几秒，鼠标划过同一屏输出时不会反复读盘。
import { machineOf } from '@/features/machines/store'
import type { TerminalRecord } from '../../../../shared/types/terminal'
import { projectPath } from './terminalLinks'

const LIST_TTL = 5000
const roots = new Map<string, Promise<string | null>>()
const listings = new Map<string, { at: number; names: Promise<Set<string> | null> }>()

function rootOf(projectId: string): Promise<string | null> {
  let root = roots.get(projectId)
  if (!root) {
    root = window
      .pixelsky!.files.target({ projectId })
      .then(t => t.path)
      .catch(() => null)
    roots.set(projectId, root)
  }
  return root
}

function namesIn(projectId: string, dir: string, windows: boolean): Promise<Set<string> | null> {
  const key = projectId + '\0' + dir,
    cached = listings.get(key)
  if (cached && Date.now() - cached.at < LIST_TTL) return cached.names
  const names = window
    .pixelsky!.files.list({ projectId }, dir)
    .then(
      list => new Set(list.entries.filter(e => e.kind === 'file').map(e => (windows ? e.name.toLowerCase() : e.name))),
    )
    .catch(() => null)
  listings.set(key, { at: Date.now(), names })
  if (listings.size > 200) listings.delete(listings.keys().next().value!)
  return names
}

/** 终端里的一个路径 → 项目内存在的文件的相对路径；不存在、在项目外或解析不了时为 null */
export async function terminalFilePath(record: TerminalRecord, raw: string): Promise<string | null> {
  const windows = machineOf(record.projectId) === 'local' && window.pixelsky?.platform === 'win32'
  const root = await rootOf(record.projectId)
  if (!root) return null
  const relative = projectPath(raw, record.cwd, root, windows)
  if (!relative) return null
  const parts = relative.split('/'),
    name = parts.pop()!
  const names = await namesIn(record.projectId, parts.join('/'), windows)
  return names?.has(windows ? name.toLowerCase() : name) ? relative : null
}
