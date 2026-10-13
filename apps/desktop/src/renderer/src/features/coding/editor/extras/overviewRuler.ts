// 概览标尺：编辑器右边一条 8px 的竖条，画改动位置（对比 HEAD）和当前可视区域，点一下跳到那一行
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { changedLines } from '@/features/editor/code/gutter'
import { RULER_MIN_MARK, lineAtRatio, rulerMarks, viewportBox } from './rulerModel'

export const RULER_WIDTH = 8
/** 改动多了重算会卡，改完等一下再算 */
const RECALC_DELAY = 150

const rulerTheme = EditorView.theme({
  // 给标尺让出位置，滚动条留在标尺左边
  '.cm-scroller': { marginRight: `${RULER_WIDTH}px` },
  '.cm-overview-ruler': {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    width: `${RULER_WIDTH}px`,
    cursor: 'pointer',
    zIndex: '5',
  },
  '.cm-overview-viewport': {
    position: 'absolute',
    left: '0',
    right: '0',
    background: 'var(--bg-selected)',
    pointerEvents: 'none',
  },
  '.cm-overview-mark': { position: 'absolute', left: '1px', right: '1px', borderRadius: '1px', pointerEvents: 'none' },
  '.cm-overview-mark[data-kind="added"]': { background: 'var(--success)' },
  '.cm-overview-mark[data-kind="modified"]': { background: 'var(--diff-modified)' },
  '.cm-overview-mark[data-kind="deleted"]': { background: 'var(--danger)' },
})

export function overviewRuler(head: string | null): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      readonly track = document.createElement('div')
      readonly box = document.createElement('div')
      readonly marksLayer = document.createElement('div')
      changes: ReturnType<typeof changedLines> = []
      timer = 0
      lastHeight = 0
      readonly onScroll = (): void => this.paintBox()
      readonly onDown = (e: MouseEvent): void => {
        e.preventDefault()
        const rect = this.track.getBoundingClientRect()
        const line = lineAtRatio(e.clientY - rect.top, rect.height, this.view.state.doc.lines)
        const pos = this.view.state.doc.line(line).from
        this.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
        this.view.focus()
      }
      constructor(readonly view: EditorView) {
        this.track.className = 'cm-overview-ruler'
        this.box.className = 'cm-overview-viewport'
        this.track.append(this.box, this.marksLayer)
        this.track.addEventListener('mousedown', this.onDown)
        view.dom.appendChild(this.track)
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
        this.recalc()
      }
      recalc(): void {
        this.changes = head === null ? [] : changedLines(head, this.view.state.doc.toString())
        this.paintMarks()
        this.paintBox()
      }
      paintMarks(): void {
        const height = this.track.clientHeight
        const lines = this.view.state.doc.lines
        this.lastHeight = height
        const marks = rulerMarks(this.changes, lines, height)
        this.marksLayer.replaceChildren(
          ...marks.map(m => {
            const el = document.createElement('div')
            el.className = 'cm-overview-mark'
            el.dataset.kind = m.kind
            el.style.top = `${m.top}px`
            el.style.height = `${Math.max(RULER_MIN_MARK, m.height)}px`
            return el
          }),
        )
      }
      paintBox(): void {
        const s = this.view.scrollDOM
        const b = viewportBox(s.scrollTop, s.clientHeight, s.scrollHeight, this.track.clientHeight)
        this.box.style.top = `${b.top}px`
        this.box.style.height = `${b.height}px`
      }
      update(u: ViewUpdate): void {
        if (u.docChanged) {
          window.clearTimeout(this.timer)
          this.timer = window.setTimeout(() => this.recalc(), RECALC_DELAY)
        } else if (u.geometryChanged && this.track.clientHeight !== this.lastHeight) {
          this.paintMarks()
        }
        if (u.docChanged || u.geometryChanged || u.viewportChanged) this.paintBox()
      }
      destroy(): void {
        window.clearTimeout(this.timer)
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
        this.track.removeEventListener('mousedown', this.onDown)
        this.track.remove()
      }
    },
  )
  return [plugin, rulerTheme]
}
