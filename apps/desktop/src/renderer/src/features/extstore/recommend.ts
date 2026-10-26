// 打开某种语言的文件时推荐对应的官方语言扩展（docs/ui/official-language-extensions.md §4）：
// 没装过、没推荐过的才提示，每个扩展一辈子只提示一次；商店连不上、找不到这个扩展时不提示也不记。
import type { ExtPackState } from '@pixelsky/protocol'

/** 官方语言扩展 → 它负责的文件扩展名（小写） */
export const OFFICIAL_LANGUAGE_PACKS: Readonly<Record<string, readonly string[]>> = {
  'pixelsky.python': ['.py', '.pyi'],
  'pixelsky.typescript': ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  'pixelsky.go': ['.go'],
  'pixelsky.rust': ['.rs'],
  'pixelsky.java': ['.java'],
  'pixelsky.cpp': ['.c', '.h', '.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx'],
  'pixelsky.csharp': ['.cs', '.csx'],
  'pixelsky.kotlin': ['.kt', '.kts'],
  'pixelsky.php': ['.php'],
  'pixelsky.ruby': ['.rb', '.rake', '.gemspec'],
  'pixelsky.swift': ['.swift'],
  'pixelsky.dart': ['.dart'],
  'pixelsky.lua': ['.lua'],
  'pixelsky.powershell': ['.ps1', '.psm1', '.psd1'],
  'pixelsky.vue': ['.vue'],
  'pixelsky.svelte': ['.svelte'],
}

/** 这个文件对应的官方语言扩展 id；没有返回 null */
export function officialPackFor(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot)
  for (const [id, exts] of Object.entries(OFFICIAL_LANGUAGE_PACKS)) if (exts.includes(ext)) return id
  return null
}

/** 该不该推荐：扩展列表读完了、没装过（停用的也算装过）、以前没推荐过 */
export function shouldRecommend(id: string, packs: ExtPackState, shown: ReadonlySet<string>): boolean {
  if (packs.loading || shown.has(id)) return false
  return !packs.packs.some(p => p.id === id)
}

const KEY = 'pixelsky.extRecommendShown'

export function shownRecommendations(): Set<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function markRecommended(id: string): void {
  const next = shownRecommendations()
  next.add(id)
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    // 存不了（无痕等）：这次打开应用里不会再提示，下次可能再提示一次
  }
}
