// 粘贴段的记录跟着草稿存（docs/ui/composer-paste-fold.md §5）：按草稿键，localStorage
import type { PasteChunk } from './pasteFold'

const STORAGE = 'pixelsky.composer-pastes'

function readAll(): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 这个草稿记下的粘贴段（没校验，交给 resetPastes） */
export function loadPastes(key: string): readonly unknown[] {
  const value = readAll()[key]
  return Array.isArray(value) ? value : []
}

export function savePastes(key: string, chunks: readonly PasteChunk[]): void {
  const all = readAll()
  if (chunks.length) all[key] = chunks
  else delete all[key]
  try {
    localStorage.setItem(STORAGE, JSON.stringify(all))
  } catch {
    // 存不了就只在这次有效
  }
}
