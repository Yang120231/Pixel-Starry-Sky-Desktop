import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileCode2,
  Minus,
  Plus,
  Undo2,
} from 'lucide-react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from '@codemirror/merge'
import { IconButton, Segmented, Spinner } from '@/components/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { editorTheme } from '@/editor/code/theme'
import { mergeTheme } from '@/editor/code/mergeTheme'
import { loadLanguage } from '@/editor/code/languages'
import { useRemember } from '../ToolsUi'
import type { GitArea, GitDiff, GitFileChange } from '../../../../../shared/types/project-tools'
import { diffMode, SPLIT_MIN_WIDTH, splitPath } from './gitModel'

const COLLAPSE = { margin: 3, minSize: 4 }

/** 只读的差异编辑器：并排用 MergeView，行内用 unifiedMergeView；navRef 指向可以跳转改动的那个编辑器 */
function DiffEditor({
  diff,
  mode,
  navRef,
}: {
  diff: GitDiff
  mode: 'split' | 'inline'
  navRef: { current: EditorView | null }
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let destroy = (): void => {}
    let disposed = false
    void loadLanguage(diff.path).then(language => {
      if (disposed) return
      const base = [
        editorTheme,
        mergeTheme,
        lineNumbers(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        language,
      ]
      const original = diff.original ?? '',
        modified = diff.modified ?? ''
      if (mode === 'split') {
        const view = new MergeView({
          a: { doc: original, extensions: base },
          b: { doc: modified, extensions: base },
          parent,
          collapseUnchanged: COLLAPSE,
          gutter: true,
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
              unifiedMergeView({ original, mergeControls: false, collapseUnchanged: COLLAPSE, gutter: true }),
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
  }, [diff, mode])
  return (
    <div
      ref={host}
      data-git-diff={mode}
      className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-mergeView]:h-full [&_.cm-mergeView]:overflow-y-auto [&_.cm-mergeViewEditors]:min-h-full"
    />
  )
}

/** Git 面板里点进去看一个文件的差异（docs/ui/git-panel.md §2.5） */
export function GitDiffView({
  file,
  area,
  load,
  onBack,
  onNeighbour,
  onStage,
  onUnstage,
  onDiscard,
  onOpen,
  busy,
}: {
  file: GitFileChange
  area: GitArea
  load: () => Promise<GitDiff>
  onBack: () => void
  onNeighbour: (delta: 1 | -1) => void
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
  onOpen?: () => void
  busy: boolean
}) {
  useI18n()
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [error, setError] = useState('')
  const [preferred, setPreferred] = useRemember<'split' | 'inline'>('pixelsky.git.diffMode', 'inline')
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const nav = useRef<EditorView | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let gone = false
    setDiff(null)
    setError('')
    load().then(
      d => {
        if (!gone) setDiff(d)
      },
      e => {
        if (!gone) setError((e as Error).message)
      },
    )
    return () => {
      gone = true
    }
  }, [file.path, area, file.code])
  const mode = diffMode(preferred, width)
  const { name, dir } = splitPath(file.path)
  const jump = (delta: 1 | -1) => {
    const view = nav.current
    if (view) {
      ;(delta > 0 ? goToNextChunk : goToPreviousChunk)({ state: view.state, dispatch: view.dispatch })
      view.focus()
    }
  }
  const same = diff && !diff.binary && !diff.tooLarge && diff.original === diff.modified
  return (
    <div ref={box} data-git-diff-view className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle px-2 py-1.5">
        <IconButton icon={ArrowLeft} label={tr('git.back')} size={28} iconSize={15} onClick={onBack} />
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-list font-medium text-fg" title={file.path}>
            {name}
          </div>
          {(dir || file.origPath) && (
            <div className="truncate text-meta text-fg-faint">
              {file.origPath ? `${file.origPath} → ` : ''}
              {dir}
            </div>
          )}
        </div>
        <IconButton
          icon={ChevronUp}
          label={tr('git.diff.prev')}
          size={26}
          iconSize={14}
          onClick={() => jump(-1)}
          disabled={!diff || !!same}
        />
        <IconButton
          icon={ChevronDown}
          label={tr('git.diff.next')}
          size={26}
          iconSize={14}
          onClick={() => jump(1)}
          disabled={!diff || !!same}
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line-subtle px-3 py-1.5">
        <span title={width < SPLIT_MIN_WIDTH ? tr('git.diff.narrow') : undefined}>
          <Segmented
            label={tr('git.diff.mode')}
            value={mode}
            disabled={width < SPLIT_MIN_WIDTH}
            onChange={setPreferred}
            options={[
              { value: 'inline', label: tr('git.diff.inline') },
              { value: 'split', label: tr('git.diff.split') },
            ]}
          />
        </span>
        <span className="flex-1" />
        <IconButton
          icon={ChevronLeft}
          label={tr('git.diff.prevFile')}
          size={26}
          iconSize={14}
          onClick={() => onNeighbour(-1)}
        />
        <IconButton
          icon={ChevronRight}
          label={tr('git.diff.nextFile')}
          size={26}
          iconSize={14}
          onClick={() => onNeighbour(1)}
        />
        {onOpen && <IconButton icon={FileCode2} label={tr('git.open')} size={26} iconSize={14} onClick={onOpen} />}
        {onStage && (
          <IconButton icon={Plus} label={tr('git.stage')} size={26} iconSize={14} disabled={busy} onClick={onStage} />
        )}
        {onUnstage && (
          <IconButton
            icon={Minus}
            label={tr('git.unstage')}
            size={26}
            iconSize={14}
            disabled={busy}
            onClick={onUnstage}
          />
        )}
        {onDiscard && (
          <IconButton
            icon={Undo2}
            label={tr('git.discard')}
            size={26}
            iconSize={14}
            disabled={busy}
            onClick={onDiscard}
          />
        )}
      </div>
      {error ? (
        <p role="alert" className="m-3 rounded-md bg-subtle p-2 text-meta text-danger">
          {error}
        </p>
      ) : !diff ? (
        <div className="flex items-center justify-center gap-2 p-6 text-meta text-fg-muted">
          <Spinner size={13} />
          {tr('git.diff.loading')}
        </div>
      ) : diff.binary || diff.tooLarge || same ? (
        <p className="m-3 rounded-md bg-subtle p-3 text-center text-meta text-fg-muted">
          {tr(diff.binary ? 'git.diff.binary' : diff.tooLarge ? 'git.diff.tooLarge' : 'git.diff.same')}
        </p>
      ) : (
        <DiffEditor key={`${file.path}:${area}:${mode}`} diff={diff} mode={mode} navRef={nav} />
      )}
    </div>
  )
}
