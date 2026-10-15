import { acceptCompletion, autocompletion } from '@codemirror/autocomplete'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { hasSnippets, snippetSource } from './source'

/**
 * 代码片段补全。只给有片段的语言装自动补全，其余语言的编辑行为不变；
 * 不订阅 onEditorPacksChanged，装卸靠 packs 隔间在扩展变化时重配。
 */
export function snippetSupport(languageId: string | null): Extension {
  if (!languageId || !hasSnippets(languageId)) return []
  return [
    autocompletion({ override: [snippetSource(languageId)], icons: false }),
    // 没有补全弹窗时返回 false，indentWithTab 照常缩进
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
  ]
}
