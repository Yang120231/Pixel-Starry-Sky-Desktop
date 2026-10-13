// 逐块审查 AI 改动（E2）。公共入口，签名见 docs/ui/coding-mode-impl.md §3.6
import { useEffect, useMemo, useRef, type JSX } from 'react'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useFiles, type OpenFile } from '@/features/files/store'
import { getEditorView } from '@/features/editor/code/CodeEditor'
import { IconButton, useToast } from '@/ui'
import { createReviewExtensions } from './reviewExtensions'
import { useReviewTarget } from './reviewTarget'
import { addUndone, markReviewed, useLive, useReviewed } from './reviewStore'

export { markTurnReviewed, useTurnReviewed } from './reviewStore'

const NONE: readonly Extension[] = []

/** 这一轮开始前的内容；找不到这个文件、二进制、只读时 null */
export function useTurnBaseline(tab: OpenFile | null): string | null {
  return useReviewTarget(tab).baseline
}

/** 红绿装饰 + 每块的保留 / 撤销 / 问 AI；基准为 null 时返回常量空数组。返回值已 memo */
export function useAiReviewExtensions(tab: OpenFile | null): readonly Extension[] {
  const target = useReviewTarget(tab)
  const reviewed = useReviewed(target.scope)
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => {
    toastRef.current = toast
  }, [toast])
  const tabId = tab?.id ?? null
  const { baseline, scope, running } = target
  return useMemo(() => {
    if (tabId === null || baseline === null || scope === null) return NONE
    return [
      createReviewExtensions({
        tabId,
        scope,
        baseline,
        running,
        reviewed,
        toast: message => toastRef.current(message),
      }),
    ]
  }, [tabId, baseline, scope, running, reviewed])
}

/** 浮在编辑器底部中间；父容器要是 relative */
export function AiReviewBar({ tabId }: { tabId: string }): JSX.Element | null {
  useI18n()
  const tab = useFiles().tabs.find(t => t.id === tabId) ?? null
  const target = useReviewTarget(tab)
  const live = useLive(tabId)
  const cursor = useRef(0)
  const hunks = live?.hunks ?? []
  const dirty = !!tab && tab.document?.kind === 'text' && tab.draft !== tab.document.content
  const undone = live && dirty ? live.undone : 0

  let notice: string | null = null
  if (target.file && target.baseline === null && tab?.document?.kind === 'text')
    notice = tr('coding.review.bar.noBaseline')
  else if (live?.tooBig) notice = tr('coding.review.bar.tooBig')
  if (!hunks.length && !notice && !undone) return null

  const go = (step: number): void => {
    const view = getEditorView(tabId)
    if (!view || !hunks.length) return
    const next = (cursor.current + step + hunks.length) % hunks.length
    cursor.current = next
    const hunk = hunks[next]
    view.dispatch({
      selection: { anchor: Math.min(hunk.fromB, view.state.doc.length) },
      effects: EditorView.scrollIntoView(Math.min(hunk.fromB, view.state.doc.length), { y: 'center' }),
    })
    view.focus()
  }
  const undoAll = (): void => {
    const view = getEditorView(tabId)
    if (!view || target.running || !hunks.length) return
    view.dispatch({
      changes: hunks.map(h => ({ from: h.undoFrom, to: h.undoTo, insert: h.undoInsert })),
      userEvent: 'input.aiundo',
    })
    addUndone(tabId, hunks.length)
  }
  const position = Math.min(cursor.current, Math.max(0, hunks.length - 1)) + 1

  return (
    <div
      data-ai-review-bar
      className="bg-popover shadow-popover border-line-card text-meta text-fg absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-lg border px-2 py-1"
    >
      {hunks.length > 0 && (
        <>
          <span className="truncate">{tr('coding.review.bar.count', { n: hunks.length })}</span>
          <span className="text-fg-muted tabular-nums">
            {tr('coding.review.bar.position', { i: position, n: hunks.length })}
          </span>
          <IconButton
            icon={ChevronUp}
            size={24}
            iconSize={14}
            label={tr('coding.review.bar.prev')}
            onClick={() => go(-1)}
          />
          <IconButton
            icon={ChevronDown}
            size={24}
            iconSize={14}
            label={tr('coding.review.bar.next')}
            onClick={() => go(1)}
          />
          <button
            type="button"
            disabled={target.running}
            title={target.running ? tr('coding.review.undoRunning') : undefined}
            onClick={undoAll}
            className="hover:bg-hover text-fg-secondary rounded-md px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {tr('coding.review.bar.undoAll')}
          </button>
          <button
            type="button"
            onClick={() =>
              target.scope &&
              markReviewed(
                target.scope,
                hunks.map(h => h.key),
              )
            }
            className="hover:bg-hover text-fg-secondary rounded-md px-2 py-0.5"
          >
            {tr('coding.review.bar.keepAll')}
          </button>
        </>
      )}
      {undone > 0 && <span className="text-warn">{tr('coding.review.bar.undone', { n: undone })}</span>}
      {notice && <span className="text-fg-muted">{notice}</span>}
    </div>
  )
}
