import { extText, packName, type ExtLocale, type ExtPackState } from '@pixelsky/protocol'
import { contributionsFrom } from '@/features/extpacks/model'

// 代码配色的选择：深色、浅色各存一个 'packId/themeId'，null 表示跟随配色（用内置着色）。
// 导入时没有副作用，node 测试可以直接 import。

export const EDITOR_THEME_KEY = 'pixelsky.editor.colorTheme'

export interface EditorThemeChoice {
  dark: string | null
  light: string | null
}

const listeners = new Set<() => void>()
let storageHooked = false

function parse(raw: string | null): EditorThemeChoice {
  const out: EditorThemeChoice = { dark: null, light: null }
  if (!raw) return out
  try {
    const v = JSON.parse(raw) as Partial<Record<'dark' | 'light', unknown>>
    for (const mode of ['dark', 'light'] as const) {
      const value = v?.[mode]
      if (typeof value === 'string' && value.includes('/')) out[mode] = value
    }
  } catch {
    // 存坏了就当没选
  }
  return out
}

export function getEditorThemeChoice(): EditorThemeChoice {
  try {
    if (typeof localStorage === 'undefined') return { dark: null, light: null }
    return parse(localStorage.getItem(EDITOR_THEME_KEY))
  } catch {
    return { dark: null, light: null }
  }
}

export function setEditorThemeChoice(mode: 'dark' | 'light', value: string | null): void {
  const next = { ...getEditorThemeChoice(), [mode]: value }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(EDITOR_THEME_KEY, JSON.stringify(next))
  } catch {
    // 存不了也照常通知
  }
  for (const l of [...listeners]) l()
}

/** 选择变化（本窗口、其他窗口）；第一次订阅时才挂 storage 事件 */
export function onEditorThemeChoiceChange(listener: () => void): () => void {
  if (!storageHooked && typeof window !== 'undefined') {
    storageHooked = true
    window.addEventListener('storage', e => {
      if (e.key === EDITOR_THEME_KEY) for (const l of [...listeners]) l()
    })
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 某个深 / 浅色下能选的主题；标签重名时带上扩展名 */
export function editorThemeOptions(
  state: ExtPackState,
  mode: 'dark' | 'light',
  locale: ExtLocale,
): Array<{ value: string; label: string }> {
  const items = contributionsFrom(state, 'themes')
    .filter(c => c.item.uiTheme === mode && c.pack.id)
    .map(c => ({
      value: `${c.pack.id}/${c.item.id}`,
      label: extText(c.item.label, locale) || c.item.id,
      pack: c.pack.manifest ? packName(c.pack.manifest, locale) : (c.pack.id as string),
    }))
  const count = new Map<string, number>()
  for (const i of items) count.set(i.label, (count.get(i.label) ?? 0) + 1)
  return items.map(i => ({ value: i.value, label: (count.get(i.label) ?? 0) > 1 ? `${i.label} (${i.pack})` : i.label }))
}
