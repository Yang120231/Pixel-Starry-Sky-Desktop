// 逐块审查的 CodeMirror 扩展：StateField 算出改动块，装饰画红绿，每块一个「保留 / 撤销 / 问 AI」小条
import { RangeSetBuilder, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import { tr } from '@/i18n/core'
import { quoteSelection } from '@/features/editor/code/CodeEditor'
import { reviewHunks, type ReviewHunk } from './hunksModel'
import { addUndone, clearLive, markReviewed, publishLive } from './reviewStore'

/** 块数或行数超过这个值就不启用 */
export const MAX_HUNKS = 200
export const MAX_LINES = 5000

export interface ReviewContext {
  tabId: string
  scope: string
  baseline: string
  running: boolean
  reviewed: ReadonlySet<string> | 'all'
  toast(message: string): void
}

interface ReviewState {
  hunks: readonly ReviewHunk[]
  tooBig: boolean
  deco: DecorationSet
}

const added = 'color-mix(in srgb, var(--success) 12%, transparent)'
const removed = 'color-mix(in srgb, var(--danger) 12%, transparent)'

const theme = EditorView.baseTheme({
  '.cm-ai-added': { backgroundColor: added },
  '.cm-ai-first': { position: 'relative' },
  '.cm-ai-deleted': {
    position: 'relative',
    backgroundColor: removed,
    padding: '0 14px',
    color: 'var(--text-muted)',
  },
  '.cm-ai-deleted-line': { textDecoration: 'line-through', whiteSpace: 'pre', minHeight: '1em' },
  '.cm-ai-tools': {
    position: 'absolute',
    right: '12px',
    top: '1px',
    display: 'inline-flex',
    gap: '2px',
    padding: '1px',
    borderRadius: '6px',
    border: '1px solid var(--border-card)',
    backgroundColor: 'var(--bg-popover)',
    boxShadow: 'var(--shadow-sm)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-label)',
    lineHeight: '1.4',
    textDecoration: 'none',
    zIndex: '2',
  },
  '.cm-ai-tools button': {
    border: '0',
    background: 'transparent',
    color: 'var(--text-secondary)',
    padding: '1px 7px',
    borderRadius: '4px',
    cursor: 'pointer',
    font: 'inherit',
  },
  '.cm-ai-tools button:hover:not(:disabled)': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  '.cm-ai-tools button:disabled': { opacity: '0.45', cursor: 'not-allowed' },
})

type MakeTools = (index: number, hunk: ReviewHunk) => WidgetType

function compute(state: EditorState, ctx: ReviewContext, toolbar: MakeTools): ReviewState {
  const doc = state.doc
  const none: ReviewState = { hunks: [], tooBig: false, deco: Decoration.none }
  if (doc.lines > MAX_LINES || ctx.baseline.split('\n').length > MAX_LINES) return { ...none, tooBig: true }
  let all = reviewHunks(ctx.baseline, doc.toString())
  if (all.length > MAX_HUNKS) return { ...none, tooBig: true }
  const reviewed = ctx.reviewed
  if (reviewed === 'all') all = []
  else if (reviewed.size) all = all.filter(h => !reviewed.has(h.key))
  const ranges: Range<Decoration>[] = []
  all.forEach((hunk, index) => {
    if (hunk.hasCurrent) {
      const first = doc.lineAt(hunk.fromB)
      const last = doc.lineAt(hunk.toB)
      for (let n = first.number; n <= last.number; n++) {
        const line = doc.line(n)
        ranges.push(
          Decoration.line({ class: n === first.number ? 'cm-ai-added cm-ai-first' : 'cm-ai-added' }).range(line.from),
        )
      }
      ranges.push(Decoration.widget({ widget: toolbar(index, hunk), side: 1 }).range(first.to))
    }
    if (hunk.hasBaseline) {
      const at = hunk.hasCurrent ? doc.lineAt(hunk.fromB).from : Math.min(hunk.fromB, doc.length)
      ranges.push(
        Decoration.widget({
          widget: new DeletedWidget(ctx, hunk, index, hunk.hasCurrent ? null : toolbar(index, hunk)),
          block: true,
          side: -1,
        }).range(at),
      )
    }
  })
  const builder = new RangeSetBuilder<Decoration>()
  ranges
    .sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
    .forEach(r => builder.add(r.from, r.to, r.value))
  return { hunks: all, tooBig: false, deco: builder.finish() }
}

/** 三个按钮；点的时候按下标回到当前的块（文档改过之后块会重新算） */
class ToolsWidget extends WidgetType {
  constructor(
    readonly ctx: ReviewContext,
    readonly hunk: ReviewHunk,
    readonly index: number,
    readonly lookup: (view: EditorView, index: number, key: string) => ReviewHunk | null,
  ) {
    super()
  }
  eq(other: ToolsWidget): boolean {
    return other.ctx === this.ctx && other.index === this.index && other.hunk.key === this.hunk.key
  }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('span')
    root.className = 'cm-ai-tools'
    root.setAttribute('data-ai-review-tools', '')
    const make = (label: string, title: string, run: (hunk: ReviewHunk) => void, disabled = false): void => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.title = title
      button.disabled = disabled
      button.addEventListener('mousedown', e => e.preventDefault())
      button.addEventListener('click', () => {
        const hunk = this.lookup(view, this.index, this.hunk.key)
        if (hunk) run(hunk)
      })
      root.append(button)
    }
    const { ctx } = this
    make(tr('coding.review.keep'), tr('coding.review.keepTitle'), hunk => markReviewed(ctx.scope, [hunk.key]))
    make(
      tr('coding.review.undo'),
      ctx.running ? tr('coding.review.undoRunning') : tr('coding.review.undoTitle'),
      hunk => {
        if (ctx.running) return
        view.dispatch({
          changes: { from: hunk.undoFrom, to: hunk.undoTo, insert: hunk.undoInsert },
          userEvent: 'input.aiundo',
        })
        addUndone(ctx.tabId, 1)
      },
      ctx.running,
    )
    make(tr('coding.review.ask'), tr('coding.review.askTitle'), hunk => {
      view.dispatch({ selection: { anchor: hunk.fromB, head: hunk.toB } })
      const error = quoteSelection(ctx.tabId)
      if (error) ctx.toast(error)
    })
    return root
  }
  ignoreEvent(): boolean {
    return true
  }
}

class DeletedWidget extends WidgetType {
  constructor(
    readonly ctx: ReviewContext,
    readonly hunk: ReviewHunk,
    readonly index: number,
    readonly tools: WidgetType | null,
  ) {
    super()
  }
  eq(other: DeletedWidget): boolean {
    return (
      other.ctx === this.ctx &&
      other.index === this.index &&
      other.hunk.baselineText === this.hunk.baselineText &&
      !other.tools === !this.tools
    )
  }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div')
    root.className = 'cm-ai-deleted'
    root.setAttribute('data-ai-review-deleted', '')
    root.setAttribute('aria-label', tr('coding.review.deletedBlock'))
    for (const text of this.hunk.baselineText.split('\n')) {
      const line = document.createElement('div')
      line.className = 'cm-ai-deleted-line'
      line.textContent = text
      root.append(line)
    }
    if (this.tools) root.append(this.tools.toDOM(view))
    return root
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** 一个文件标签的审查扩展；ctx 变了就要重新建（调用方 memo） */
export function createReviewExtensions(ctx: ReviewContext): Extension {
  const owner = {}
  const lookup = (view: EditorView, index: number, key: string): ReviewHunk | null => {
    const hunk = view.state.field(field).hunks[index]
    return hunk && hunk.key === key ? hunk : null
  }
  const toolbar: MakeTools = (index, hunk) => new ToolsWidget(ctx, hunk, index, lookup)
  const field: StateField<ReviewState> = StateField.define<ReviewState>({
    create: state => compute(state, ctx, toolbar),
    update: (value, transaction) => (transaction.docChanged ? compute(transaction.state, ctx, toolbar) : value),
    provide: f => EditorView.decorations.from(f, value => value.deco),
  })
  const publisher = ViewPlugin.define(view => {
    const publish = (): void => {
      const value = view.state.field(field)
      publishLive(ctx.tabId, { owner, scope: ctx.scope, hunks: value.hunks, tooBig: value.tooBig })
    }
    publish()
    return {
      update(update) {
        if (update.state.field(field) !== update.startState.field(field)) publish()
      },
      destroy() {
        clearLive(ctx.tabId, owner)
      },
    }
  })
  return [theme, field, publisher]
}
