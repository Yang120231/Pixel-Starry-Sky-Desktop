import type { CheckItem, WslDistro } from '../../shared/types/machines'
import { wslMachineId } from './wslList'

// userData/wsl-machines.json 里每个发行版一条；不放进 machines.json，旧版本读到不认识的条目不会把它们写丢
export interface WslRecord {
  id: string
  distro: string
  nodePath?: string
  lastCheck?: { at: number; items: CheckItem[] }
}
export interface WslEntry {
  record: WslRecord
  /** 当前列表里的发行版；null = 已不在列表里（只有已连接的才会留在界面上） */
  distro: WslDistro | null
}

const ID = /^wsl-[a-f0-9]{12}$/
const MAX_RECORDS = 50

const isCheckItem = (item: unknown): item is CheckItem => {
  const i = item as CheckItem
  return !!i && typeof i.key === 'string' && typeof i.status === 'string' && typeof i.detail === 'string'
}

/** 读 wsl-machines.json：只认 wsl-<12 位十六进制>，字段不对的丢掉。 */
export function parseWslRecords(raw: unknown): WslRecord[] {
  const list = (raw as { machines?: unknown } | null)?.machines
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const result: WslRecord[] = []
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || !ID.test(item.id) || seen.has(item.id)) continue
    if (typeof item.distro !== 'string' || !item.distro.trim() || item.distro.length > 255) continue
    if (/[\r\n\0]/.test(item.distro) || wslMachineId(item.distro) !== item.id) continue
    seen.add(item.id)
    const record: WslRecord = { id: item.id, distro: item.distro }
    if (typeof item.nodePath === 'string' && isNodePath(item.nodePath)) record.nodePath = item.nodePath
    const check = item.lastCheck
    if (check && Number.isFinite(check.at) && Array.isArray(check.items) && check.items.every(isCheckItem))
      record.lastCheck = { at: check.at, items: check.items.slice(0, 20) }
    result.push(record)
    if (result.length >= MAX_RECORDS) break
  }
  return result
}

/** 只写有内容的记录：刚检测到、没选过的发行版不落盘。 */
export const persistableRecords = (records: Iterable<WslRecord>): WslRecord[] =>
  [...records].filter(r => r.nodePath || r.lastCheck)

const isNodePath = (path: string): boolean =>
  path.startsWith('/') && !/[\r\n\0]/.test(path) && !path.startsWith('/mnt/') && path.length <= 1024

/** 用户指定的 node 路径：绝对 Linux 路径，不能在 /mnt/（那是 Windows 的 node）。 */
export function checkNodePath(path: unknown): string {
  if (typeof path !== 'string' || !isNodePath(path.trim())) throw new Error('WSL_NODE_PATH_INVALID')
  return path.trim()
}

/**
 * 决定界面显示哪些发行版：列表里的都显示（没有记录就先建一条内存里的）；
 * 记录有、列表里没有的：已连接的留着（distro 为 null），否则隐藏，记录仍留在文件里。
 */
export function mergeWsl(records: Map<string, WslRecord>, distros: WslDistro[], connected: Set<string>): WslEntry[] {
  const shown: WslEntry[] = []
  const listed = new Set<string>()
  for (const distro of distros) {
    const id = wslMachineId(distro.name)
    if (listed.has(id)) continue
    listed.add(id)
    let record = records.get(id)
    if (!record) {
      record = { id, distro: distro.name }
      records.set(id, record)
    } else record.distro = distro.name
    shown.push({ record, distro })
  }
  for (const record of records.values())
    if (!listed.has(record.id) && connected.has(record.id)) shown.push({ record, distro: null })
  return shown
}
