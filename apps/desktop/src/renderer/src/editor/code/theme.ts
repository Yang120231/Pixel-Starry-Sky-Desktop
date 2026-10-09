import { tr } from '../../i18n/core'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const editorTheme = [
  EditorView.theme({
    '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--bg-app)', fontSize: 'var(--text-meta)' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
    '.cm-content': { padding: '8px 0', caretColor: 'var(--accent)' },
    '.cm-line': { padding: '0 14px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--bg-selected)',
    },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
    '.cm-gutters': {
      color: 'var(--text-faint)',
      backgroundColor: 'var(--bg-app)',
      borderRight: '1px solid var(--border-layout)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 5px' },
    '.cm-foldGutter span': { color: 'var(--text-muted)' },
    '.cm-tooltip, .cm-panels': {
      color: 'var(--text)',
      backgroundColor: 'var(--bg-popover)',
      borderColor: 'var(--border)',
    },
    '.cm-panel.cm-search': { padding: '8px', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-meta)' },
    '.cm-dialog': { padding: '8px', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-meta)' },
    '.cm-dialog input, .cm-dialog button': {
      color: 'var(--text)',
      background: 'var(--bg-subtle)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      font: 'inherit',
    },
    '.cm-textfield, .cm-button': {
      color: 'var(--text)',
      background: 'var(--bg-subtle)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      fontFamily: 'var(--font-sans)',
    },
    '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-border)' },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--bg-selected)', outline: '1px solid var(--accent)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--bg-selected)' },
    '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' },
    '.cm-git-gutter': { width: '5px' },
    '.cm-git-added': { borderLeft: '3px solid var(--success)' },
    '.cm-git-modified': { borderLeft: '3px solid var(--syn-func)' },
    '.cm-git-deleted': { borderTop: '3px solid var(--danger)' },
    '.cm-external-change': { backgroundColor: 'var(--accent-soft)' },
  }),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: [tags.comment], color: 'var(--syn-comment)' },
      { tag: [tags.keyword, tags.operator], color: 'var(--syn-keyword)' },
      { tag: [tags.string, tags.regexp], color: 'var(--syn-string)' },
      { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
      { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syn-func)' },
      { tag: [tags.typeName, tags.className], color: 'var(--syn-type)' },
      { tag: [tags.meta, tags.tagName, tags.attributeName], color: 'var(--syn-meta)' },
    ]),
  ),
]

export const editorPhrases = {
  get Find() {
    return tr('editor.code.theme.message416')
  },
  get Replace() {
    return tr('editor.code.theme.message417')
  },
  get 'Replace all'() {
    return tr('editor.code.theme.message418')
  },
  get replace() {
    return tr('editor.code.theme.message417')
  },
  get 'replace all'() {
    return tr('editor.code.theme.message418')
  },
  get next() {
    return tr('editor.code.theme.message419')
  },
  get previous() {
    return tr('editor.code.theme.message420')
  },
  get all() {
    return tr('editor.code.theme.message421')
  },
  get 'match case'() {
    return tr('editor.code.theme.message422')
  },
  get regexp() {
    return tr('editor.code.theme.message423')
  },
  get 'by word'() {
    return tr('editor.code.theme.message424')
  },
  get close() {
    return tr('editor.code.theme.message425')
  },
  get 'Go to line'() {
    return tr('editor.code.theme.message426')
  },
  get go() {
    return tr('editor.code.theme.message427')
  },
  get 'Fold line'() {
    return tr('editor.code.theme.message428')
  },
  get 'Unfold line'() {
    return tr('editor.code.theme.message429')
  },
  get to() {
    return tr('editor.code.theme.message430')
  },
  get 'No matches'() {
    return tr('editor.code.theme.message431')
  },
}
