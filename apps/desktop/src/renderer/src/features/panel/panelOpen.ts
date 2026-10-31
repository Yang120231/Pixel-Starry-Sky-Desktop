/** 右侧面板开合按对话（当前窗格的标签）各自记住；没开合过的对话沿用最近一次的开合 */
const KEY = 'pixelsky.right-workspace.open-by-tab'
export const LAST_OPEN_KEY = 'pixelsky.right-workspace.open'
const MAX = 200

export type OpenMap = Record<string, boolean>

export function readOpenMap(): OpenMap {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'boolean')) as OpenMap
  } catch {
    return {}
  }
}

export function saveOpenMap(map: OpenMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {}
}

/** 记一个对话的开合：挪到最后（最近用的），超过上限丢最早的（删掉的会话不会一直留着） */
export function withOpen(map: OpenMap, key: string, open: boolean): OpenMap {
  const { [key]: _, ...rest } = map
  const entries = [...Object.entries(rest), [key, open] as const]
  return Object.fromEntries(entries.slice(-MAX))
}
