import type { EditorView } from '@codemirror/view'
import { Sparkles } from 'lucide-react'
import { tr, getLocale } from '@/i18n/core'
import type { MenuAction } from '@/ui/ActionMenu'
import { appendComposerDraft } from '@/features/engine/drafts'
import { composerTarget, focusComposer } from '@/features/session/composerTarget'
import { fileLanguage } from '@/features/editor/code/languages'
import { getPackState } from '../store'
import { fillPrompt, promptItems } from './model'
import { loadPromptBody } from './load'

export interface PromptMenuContext {
  tabId: string
  path: string
  view: EditorView
  toast: (message: string) => void
}

const baseName = (path: string): string =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? ''

/** 编辑器右键菜单里的「发给 AI」子菜单：把扩展提示词填好放进输入框，不发送 */
export function promptMenuActions(ctx: PromptMenuContext): MenuAction[] {
  const { path, view, toast } = ctx
  const { state } = view
  const selection = state.selection.ranges
    .filter(r => !r.empty)
    .map(r => state.sliceDoc(r.from, r.to))
    .join(state.lineBreak)
  // 要选中内容的提示词没有选中时不显示
  const items = promptItems(getPackState(), 'editor', getLocale()).filter(item => selection || !item.requiresSelection)
  if (!items.length) return []
  return [
    {
      label: tr('prompts.sendToAi'),
      icon: Sparkles,
      separator: true,
      children: items.map(item => ({
        label: item.title,
        run: () => {
          const target = composerTarget()
          if (!target) return toast(tr('editor.quote.noSession'))
          void loadPromptBody(item)
            .then(body => {
              const text = fillPrompt(body, {
                selection,
                file: path,
                language: path ? fileLanguage(path) : '',
                project: target.cwd ? baseName(target.cwd) : '',
              })
              appendComposerDraft(target.key, text)
              focusComposer(target.key)
            })
            .catch((e: unknown) => toast(tr('prompts.loadFailed', { error: (e as Error).message })))
        },
      })),
    },
  ]
}
