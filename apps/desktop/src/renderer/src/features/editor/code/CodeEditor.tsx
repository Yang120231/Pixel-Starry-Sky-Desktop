import { useI18n } from '@/i18n/I18nProvider'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands'
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  selectNextOccurrence,
} from '@codemirror/search'
import { FILE_CLOSED_EVENT, getFiles, saveFile, updateFile, type OpenFile } from '@/features/files/store'
import { motionEnabled } from '@/features/panes/motion'
import { changeGutter, changedLines, setExternalLines, setGitChanges } from './gutter'
import { loadLanguage } from './languages'
import { editorPhrases, editorTheme } from './theme'
import { fileIndent, linePosition } from './positions'

type Runtime = {
  view: EditorView
  readonly: Compartment
  language: Compartment
  phrases: Compartment
  wrap: Compartment
  large: boolean
  timer?: number
  flashTimer?: number
  revealSeq: number
  changed: number
}
const runtimes = new Map<string, Runtime>()
window.addEventListener(FILE_CLOSED_EVENT, e => {
  const id = (e as CustomEvent<string>).detail,
    runtime = runtimes.get(id)
  if (runtime) {
    window.clearTimeout(runtime.timer)
    window.clearTimeout(runtime.flashTimer)
    runtime.view.destroy()
    runtimes.delete(id)
  }
})

function recalc(id: string, runtime: Runtime): void {
  const tab = getFiles().tabs.find(t => t.id === id)
  runtime.view.dispatch({
    effects: setGitChanges.of(
      tab?.head !== null && tab?.head !== undefined && tab.document?.kind === 'text' && !tab.document.readonly
        ? changedLines(tab.head, runtime.view.state.doc.toString())
        : [],
    ),
  })
}
export function CodeEditor({ tab, active, wordWrap = false }: { tab: OpenFile; active: boolean; wordWrap?: boolean }) {
  const { locale } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!host.current) return
    let runtime = runtimes.get(tab.id)
    if (!runtime) {
      const language = new Compartment(),
        readonly = new Compartment(),
        phrases = new Compartment(),
        wrap = new Compartment()
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: tab.draft,
          extensions: [
            editorTheme,
            wrap.of(wordWrap ? EditorView.lineWrapping : []),
            phrases.of(EditorState.phrases.of({ ...editorPhrases })),
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            drawSelection(),
            dropCursor(),
            rectangularSelection(),
            EditorView.clickAddsSelectionRange.of(e => e.altKey || e.ctrlKey || e.metaKey),
            history(),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            foldGutter(),
            highlightSelectionMatches(),
            search({ top: true }),
            changeGutter,
            indentUnit.of(fileIndent(tab.draft).unit),
            EditorState.allowMultipleSelections.of(true),
            language.of([]),
            readonly.of(EditorState.readOnly.of(!!(tab.document?.kind === 'text' && tab.document.readonly))),
            keymap.of([
              {
                key: 'Mod-s',
                run: () => {
                  void saveFile(tab.id)
                  return true
                },
              },
              { key: 'Mod-f', run: openSearchPanel },
              { key: 'Mod-h', run: openSearchPanel },
              { key: 'Mod-g', run: gotoLine },
              { key: 'Mod-d', run: selectNextOccurrence },
              { key: 'Mod-/', run: toggleComment },
              indentWithTab,
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              ...foldKeymap,
            ]),
            EditorView.updateListener.of(update => {
              if (update.docChanged) {
                updateFile(tab.id, { draft: update.state.doc.toString() })
                const current = runtimes.get(tab.id)
                if (current) {
                  window.clearTimeout(current.timer)
                  current.timer = window.setTimeout(() => recalc(tab.id, current), 180)
                }
              }
              if (update.selectionSet || update.docChanged) {
                const pos = update.state.selection.main.head,
                  line = update.state.doc.lineAt(pos)
                updateFile(tab.id, { cursor: { line: line.number, column: pos - line.from + 1 } })
              }
            }),
          ],
        }),
      })
      runtime = {
        view,
        readonly,
        language,
        phrases,
        wrap,
        large: !!(tab.document?.kind === 'text' && tab.document.readonly),
        revealSeq: -1,
        changed: tab.changed,
      }
      runtimes.set(tab.id, runtime)
      if (!(tab.document?.kind === 'text' && tab.document.readonly)) {
        const created = runtime
        void loadLanguage(tab.path)
          .then(extension => {
            if (runtimes.get(tab.id) === created && !created.large)
              created.view.dispatch({ effects: language.reconfigure(extension) })
          })
          .catch(() => {})
      }
    } else host.current.appendChild(runtime.view.dom)
    runtime.view.requestMeasure()
    return () => {
      runtime.view.dom.remove()
    }
  }, [tab.id])
  useEffect(() => {
    const runtime = runtimes.get(tab.id)
    runtime?.view.dispatch({ effects: runtime.wrap.reconfigure(wordWrap ? EditorView.lineWrapping : []) })
  }, [tab.id, wordWrap])
  useEffect(() => {
    const runtime = runtimes.get(tab.id)
    runtime?.view.dispatch({ effects: runtime.phrases.reconfigure(EditorState.phrases.of({ ...editorPhrases })) })
  }, [locale, tab.id])
  useEffect(() => {
    const runtime = runtimes.get(tab.id)
    if (!runtime) return
    const { view } = runtime,
      previous = view.state.doc.toString()
    if (previous !== tab.draft) {
      const selection = Math.min(view.state.selection.main.head, tab.draft.length)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: tab.draft },
        selection: { anchor: selection },
        annotations: Transaction.addToHistory.of(false),
      })
      if (tab.changed !== runtime.changed && motionEnabled()) {
        view.dispatch({ effects: setExternalLines.of(changedLines(previous, tab.draft).map(c => c.line)) })
        window.clearTimeout(runtime.flashTimer)
        runtime.flashTimer = window.setTimeout(() => view.dispatch({ effects: setExternalLines.of([]) }), 900)
      }
    }
    runtime.changed = tab.changed
  }, [tab.id, tab.draft, tab.changed])
  useEffect(() => {
    const runtime = runtimes.get(tab.id)
    if (!runtime) return
    const { view } = runtime
    recalc(tab.id, runtime)
    if (tab.document?.kind === 'text') {
      view.dispatch({ effects: runtime.readonly.reconfigure(EditorState.readOnly.of(!!tab.document.readonly)) })
      const wasLarge = runtime.large
      runtime.large = !!tab.document.readonly
      if (runtime.large) view.dispatch({ effects: runtime.language.reconfigure([]) })
      else if (wasLarge)
        void loadLanguage(tab.path)
          .then(extension => {
            if (runtimes.get(tab.id) === runtime && !runtime.large)
              view.dispatch({ effects: runtime.language.reconfigure(extension) })
          })
          .catch(() => {})
    }
  }, [tab.id, tab.document, tab.head])
  useEffect(() => {
    const runtime = runtimes.get(tab.id)
    if (!active || !runtime) return
    runtime.view.requestMeasure()
    if (tab.reveal && tab.reveal.seq !== runtime.revealSeq) {
      runtime.revealSeq = tab.reveal.seq
      const pos = linePosition(runtime.view.state.doc.toString(), tab.reveal.line, tab.reveal.column)
      runtime.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
      runtime.view.focus()
    }
  }, [tab.id, tab.reveal, active])
  return <div ref={host} data-code-editor={tab.id} className="min-h-0 min-w-0 flex-1 overflow-hidden" />
}
