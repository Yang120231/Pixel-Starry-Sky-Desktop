import { useMemo } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { getFiles } from '@/features/files/store'
import { getEditorView } from '@/features/editor/code/CodeEditor'
import { usePackState } from '../store'
import { promptItems, type PromptItem } from './model'

export interface PromptCommand {
  invocation: 'prompt'
  /** packId/id：不同扩展里同名的提示词也不会撞 */
  name: string
  description: string
  source: 'configured'
  prompt: PromptItem
}

/** 「/」菜单里的扩展提示词；要选中内容的提示词在没有选中时不列出 */
export function usePromptCommands(hasSelection: boolean): PromptCommand[] {
  const state = usePackState()
  const { locale } = useI18n()
  return useMemo(
    () =>
      promptItems(state, 'composer', locale)
        .filter(item => hasSelection || !item.requiresSelection)
        .map(prompt => ({
          invocation: 'prompt' as const,
          name: `${prompt.packId}/${prompt.id}`,
          description: prompt.description ? `${prompt.title} — ${prompt.description}` : prompt.title,
          source: 'configured' as const,
          prompt,
        })),
    [state, locale, hasSelection],
  )
}

/** 当前文件标签里选中的文字（多段选区用换行连起来）；没有选中或不是文本标签时为 null */
export function activeEditorSelection(): { text: string; path: string } | null {
  const { tabs, active } = getFiles()
  const tab = tabs.find(t => t.id === active)
  const view = tab ? getEditorView(tab.id) : null
  if (!tab || !view) return null
  const { state } = view
  const text = state.selection.ranges
    .filter(r => !r.empty)
    .map(r => state.sliceDoc(r.from, r.to))
    .join(state.lineBreak)
  return text ? { text, path: tab.path } : null
}
