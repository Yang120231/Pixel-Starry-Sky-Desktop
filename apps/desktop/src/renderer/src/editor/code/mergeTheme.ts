// Git 差异视图的配色（docs/ui/git-panel.md §2.5）：覆盖 @codemirror/merge 的固定颜色，改用设计变量，浅色 / 深色都跟着主题走
import { EditorView } from '@codemirror/view'

const removed = 'color-mix(in srgb, var(--danger) 12%, transparent)'
const removedText = 'color-mix(in srgb, var(--danger) 28%, transparent)'
const added = 'color-mix(in srgb, var(--success) 12%, transparent)'
const addedText = 'color-mix(in srgb, var(--success) 28%, transparent)'

export const mergeTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: removed },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': { backgroundColor: added },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': { background: removedText },
  '&.cm-merge-b .cm-changedText': { background: addedText },
  '&.cm-merge-b .cm-deletedText': { background: removedText },
  // 行内模式：新内容所在行没有 cm-merge-b 类
  '&:not(.cm-merge-a):not(.cm-merge-b) .cm-changedLine': { backgroundColor: added },
  '&:not(.cm-merge-a):not(.cm-merge-b) .cm-changedText': { background: addedText },
  '.cm-deletedChunk': { paddingLeft: '14px' },
  '.cm-collapsedLines': { color: 'var(--text-muted)', background: 'var(--bg-subtle)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-meta)', padding: '4px 14px' },
  '.cm-changeGutter': { width: '3px', paddingLeft: '1px' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: 'var(--danger)' },
  '&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter': { background: 'var(--success)' },
})
