import type { Extension } from '@codemirror/state'
import { editorColorTheme } from './colorTheme'
import { snippetSupport } from './snippets'
import { languageIdForPath } from './languageIds'

/** 扩展提供的编辑器外观部分：颜色主题 + 代码片段（放在 CodeEditor 的 packs 分区里，随时整体替换） */
export function editorPackExtensions(path: string, firstLine?: string): Extension[] {
  return [editorColorTheme(), snippetSupport(languageIdForPath(path, firstLine))]
}

/** 对比视图只要颜色主题 */
export function diffPackExtensions(): Extension[] {
  return [editorColorTheme()]
}
