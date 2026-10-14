// 粘贴段的样子（docs/ui/composer-paste-fold.md §3、§4）：折起来是一个标签（atomic），展开是浅绿底 + 开头一个「收起」小条
import { StateField, type EditorState, type Extension, type RangeSet } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { tr } from '@/i18n/core'
import { chunkPreview, chunkSize, pasteField, setFolded, type PasteChunk } from './pasteFold'

const CLIPBOARD =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>'
const CHEVRON = (up: boolean) =>
  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'}"/></svg>`

/** 标签文字：粘贴的文本 #1 · 30 行 */
export function chunkLabel(id: number, text: string): string {
  const size = chunkSize(text)
  const amount = tr(size.unit === 'lines' ? 'composer.paste.lines' : 'composer.paste.chars', {
    count: size.count.toLocaleString(),
  })
  return `${tr('composer.paste.label', { id })} · ${amount}`
}

function icon(html: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'cm-paste-icon'
  span.innerHTML = html
  return span
}

/** 折起来的标签：点了展开 */
class PillWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly label: string,
    readonly preview: string,
  ) {
    super()
  }
  eq(other: PillWidget): boolean {
    return other.id === this.id && other.label === this.label && other.preview === this.preview
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-paste-pill'
    el.dataset.pasteId = String(this.id)
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', `${this.label} · ${tr('composer.paste.expand')}`)
    el.title = `${this.preview}\n\n${tr('composer.paste.expand')}`
    el.append(icon(CLIPBOARD), document.createTextNode(this.label), icon(CHEVRON(false)))
    // mousedown 里拦掉，免得先把光标放进去
    el.addEventListener('mousedown', e => e.preventDefault())
    el.addEventListener('click', e => {
      e.preventDefault()
      view.dispatch({ effects: setFolded.of({ id: this.id, folded: false }) })
      view.focus()
    })
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** 展开后开头的小条：点「收起」折回去 */
class HeadWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly label: string,
  ) {
    super()
  }
  eq(other: HeadWidget): boolean {
    return other.id === this.id && other.label === this.label
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-paste-head'
    el.dataset.pasteId = String(this.id)
    const button = document.createElement('span')
    button.className = 'cm-paste-collapse'
    button.setAttribute('role', 'button')
    button.append(icon(CHEVRON(true)), document.createTextNode(tr('composer.paste.collapse')))
    button.addEventListener('mousedown', e => e.preventDefault())
    button.addEventListener('click', e => {
      e.preventDefault()
      view.dispatch({ effects: setFolded.of({ id: this.id, folded: true }) })
      view.focus()
    })
    el.append(icon(CLIPBOARD), document.createTextNode(this.label), button)
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

const openMark = Decoration.mark({ class: 'cm-paste-open' })
const openLine = Decoration.line({ class: 'cm-paste-line' })

function build(state: EditorState): { all: DecorationSet; atomic: RangeSet<Decoration> } {
  const chunks: readonly PasteChunk[] = state.field(pasteField)
  const all = []
  const atomic = []
  for (const c of chunks) {
    const text = state.sliceDoc(c.from, c.to)
    const label = chunkLabel(c.id, text)
    if (c.folded) {
      const replace = Decoration.replace({ widget: new PillWidget(c.id, label, chunkPreview(text)) })
      all.push(replace.range(c.from, c.to))
      atomic.push(replace.range(c.from, c.to))
    } else {
      all.push(Decoration.widget({ widget: new HeadWidget(c.id, label), side: -1 }).range(c.from))
      all.push(openMark.range(c.from, c.to))
      // 段里从行首开始的行整行铺底色（第一行如果接在别的字后面，只有 mark 的底色）
      const first = state.doc.lineAt(c.from)
      for (let pos = first.from === c.from ? c.from : first.to + 1; pos < c.to; pos = state.doc.lineAt(pos).to + 1)
        all.push(openLine.range(pos))
    }
  }
  return { all: Decoration.set(all, true), atomic: Decoration.set(atomic, true) }
}

const theme = EditorView.baseTheme({
  '.cm-paste-pill, .cm-paste-head': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    margin: '0 2px',
    padding: '0 7px',
    borderRadius: '6px',
    border: '1px solid var(--accent-border)',
    background: 'var(--accent-soft)',
    color: 'var(--accent-text)',
    fontSize: '12px',
    lineHeight: '20px',
    verticalAlign: '1px',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  '.cm-paste-pill': { cursor: 'pointer' },
  '.cm-paste-pill:hover': { filter: 'brightness(0.97)' },
  '.cm-paste-head': { marginRight: '6px' },
  '.cm-paste-collapse': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    marginLeft: '6px',
    cursor: 'pointer',
    opacity: '0.85',
  },
  '.cm-paste-collapse:hover': { opacity: '1', textDecoration: 'underline' },
  '.cm-paste-icon': { display: 'inline-flex' },
  '.cm-paste-open': { background: 'var(--accent-soft)', borderRadius: '3px' },
  // 整行：左边一道强调色细线，和段外的字分开
  '.cm-line.cm-paste-line': {
    background: 'var(--accent-soft)',
    boxShadow: 'inset 2px 0 0 var(--accent-border)',
  },
  '.cm-line.cm-paste-line .cm-paste-open': { background: 'transparent' },
})

/** 装饰跟着粘贴段和文字变（标签上的行数、预览来自段里的字）；atomic 范围是折起来的那些 */
const decorationField = StateField.define<{ all: DecorationSet; atomic: RangeSet<Decoration> }>({
  create: build,
  update(value, tr) {
    return tr.docChanged || tr.startState.field(pasteField) !== tr.state.field(pasteField) ? build(tr.state) : value
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.all),
    EditorView.atomicRanges.of(view => view.state.field(field).atomic),
  ],
})

/** 装饰、atomic 范围和样式（要和 pasteField 一起用） */
export function pasteDecorations(): Extension {
  return [decorationField, theme]
}
