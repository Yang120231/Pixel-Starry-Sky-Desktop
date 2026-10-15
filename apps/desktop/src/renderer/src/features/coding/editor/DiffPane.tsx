import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from '@codemirror/merge'
import { IconButton, Segmented } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { editorChrome } from '@/features/editor/code/theme'
import { diffPackExtensions } from '@/features/editor/code/packs'
import { useEditorPacksTick } from '@/features/editor/code/packEvents'
import { mergeTheme } from '@/features/editor/code/mergeTheme'
import { lineDiffConfig } from '@/features/editor/code/lineDiff'
import { firstLineOf } from '@/features/editor/code/languageIds'
import { loadLanguage } from '@/features/editor/code/languages'
import type { OpenFile } from '@/features/files/store'
import type { DiffBase } from '../types'

const COLLAPSE = { margin: 3, minSize: 4 }

/** 只读的差异编辑器：并排用 MergeView，行内用 unifiedMergeView；navRef 指向可以跳转改动的那个编辑器 */
function DiffEditor({
  path,
  original,
  modified,
  mode,
  navRef,
}: {
  path: string
  original: string
  modified: string
  mode: 'split' | 'inline'
  navRef: { current: EditorView | null }
}) {
  const host = useRef<HTMLDivElement>(null)
  // 扩展包、深浅色、颜色主题加载完都要重建（B4）
  const packsTick = useEditorPacksTick()
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let destroy = (): void => {}
    let disposed = false
    void loadLanguage(path, firstLineOf(modified || original)).then(language => {
      if (disposed) return
      const base = [
        editorChrome,
        ...diffPackExtensions(),
        mergeTheme,
        lineNumbers(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        language,
      ]
      if (mode === 'split') {
        const view = new MergeView({
          a: { doc: original, extensions: base },
          b: { doc: modified, extensions: base },
          parent,
          collapseUnchanged: COLLAPSE,
          gutter: true,
          diffConfig: lineDiffConfig,
        })
        navRef.current = view.b
        destroy = () => view.destroy()
      } else {
        const view = new EditorView({
          parent,
          state: EditorState.create({
            doc: modified,
            extensions: [
              ...base,
              unifiedMergeView({
                original,
                mergeControls: false,
                collapseUnchanged: COLLAPSE,
                gutter: true,
                diffConfig: lineDiffConfig,
              }),
            ],
          }),
        })
        navRef.current = view
        destroy = () => view.destroy()
      }
    })
    return () => {
      disposed = true
      navRef.current = null
      destroy()
    }
  }, [path, original, modified, mode, navRef, packsTick])
  return (
    <div
      ref={host}
      data-coding-diff={mode}
      className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-mergeView]:h-full [&_.cm-mergeView]:overflow-y-auto [&_.cm-mergeViewEditors]:min-h-full"
    />
  )
}

/**
 * 中栏的「变更」和「并排」视图：左边是基准（HEAD 或这一轮开始前），右边是当前内容，只读。
 * 照 GitDiffView 的 DiffEditor 写了一份，不引用它。
 */
export function DiffPane({
  tab,
  mode,
  base,
  turnBaseline,
  fellBack = false,
  onBase,
}: {
  tab: OpenFile
  mode: 'diff' | 'split'
  /** 已经按能不能算出这一轮的基准处理过的基准 */
  base: DiffBase
  /** 这一轮开始前的内容；算不出来是 null */
  turnBaseline: string | null
  /** 想看「只看这一轮」但算不出基准，已退回 HEAD */
  fellBack?: boolean
  onBase(base: DiffBase): void
}) {
  useI18n()
  const nav = useRef<EditorView | null>(null)
  const original = (base === 'turn' ? turnBaseline : tab.head) ?? tab.head ?? ''
  const jump = (delta: 1 | -1): void => {
    const view = nav.current
    if (!view) return
    if (delta > 0) goToNextChunk(view)
    else goToPreviousChunk(view)
    view.focus()
  }
  return (
    <div data-coding-diffpane className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        {turnBaseline !== null && (
          <Segmented
            label={tr('coding.editor.base')}
            value={base}
            onChange={onBase}
            options={[
              { value: 'head', label: tr('coding.editor.base.head') },
              { value: 'turn', label: tr('coding.editor.base.turn') },
            ]}
          />
        )}
        <span className="flex-1" />
        <IconButton icon={ChevronUp} label={tr('git.diff.prev')} size={26} iconSize={14} onClick={() => jump(-1)} />
        <IconButton icon={ChevronDown} label={tr('git.diff.next')} size={26} iconSize={14} onClick={() => jump(1)} />
      </div>
      {fellBack && (
        <p role="status" className="shrink-0 border-b border-line-subtle bg-subtle px-3 py-1 text-meta text-fg-muted">
          {tr('coding.editor.base.fallback')}
        </p>
      )}
      <DiffEditor
        path={tab.path}
        original={original}
        modified={tab.draft}
        mode={mode === 'split' ? 'split' : 'inline'}
        navRef={nav}
      />
    </div>
  )
}
