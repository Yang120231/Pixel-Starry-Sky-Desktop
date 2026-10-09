import { Chunk } from '@codemirror/merge'
import { RangeSet, StateEffect, StateField, Text, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view'

export type LineChange = { line: number; kind: 'added' | 'modified' | 'deleted' }
export function changedLines(before: string, after: string): LineChange[] {
  if (before === after || before.replace(/\r\n/g, '\n') === after.replace(/\r\n/g, '\n')) return []
  if (!after) return [{ line: 1, kind: 'deleted' }]
  if (!before) return after.split('\n').map((_line, i) => ({ line: i + 1, kind: 'added' }))
  const a = Text.of(before.replace(/\r\n/g, '\n').split('\n')),
    b = Text.of(after.replace(/\r\n/g, '\n').split('\n'))
  const result = new Map<number, LineChange['kind']>()
  for (const chunk of Chunk.build(a, b, { timeout: 25, scanLimit: 2000 })) {
    const first = b.lineAt(Math.min(chunk.fromB, b.length)).number
    if (chunk.fromB === chunk.toB) {
      result.set(first, 'deleted')
      continue
    }
    const last = b.lineAt(Math.min(Math.max(chunk.fromB, chunk.toB - 1), b.length)).number
    const kind = chunk.fromA === chunk.toA ? 'added' : 'modified'
    for (let line = first; line <= last; line++) result.set(line, kind)
  }
  return [...result].map(([line, kind]) => ({ line, kind }))
}
class Mark extends GutterMarker {
  readonly elementClass: string
  constructor(readonly kind: LineChange['kind']) {
    super()
    this.elementClass = `cm-git-${kind}`
  }
  eq(other: Mark): boolean {
    return other.kind === this.kind
  }
}
export const setGitChanges = StateEffect.define<LineChange[]>()
const markers = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects)
      if (effect.is(setGitChanges))
        value = RangeSet.of(
          effect.value.map(c => new Mark(c.kind).range(tr.state.doc.line(Math.min(c.line, tr.state.doc.lines)).from)),
          true,
        )
    return value
  },
})
export const setExternalLines = StateEffect.define<number[]>()
const externalLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects)
      if (effect.is(setExternalLines))
        value = Decoration.set(
          [...new Set(effect.value)].map(line =>
            Decoration.line({ class: 'cm-external-change' }).range(
              tr.state.doc.line(Math.max(1, Math.min(line, tr.state.doc.lines))).from,
            ),
          ),
          true,
        )
    return value
  },
  provide: field => EditorView.decorations.from(field),
})
export const changeGutter: Extension = [
  markers,
  externalLines,
  gutter({ class: 'cm-git-gutter', markers: view => view.state.field(markers) }),
]
