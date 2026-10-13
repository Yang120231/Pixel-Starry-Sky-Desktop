import { useI18n } from '@/i18n/I18nProvider'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Compartment, EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state'
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
import { ClipboardPaste, Copy, MessageSquareQuote, Scissors, TextSelect } from 'lucide-react'
import { FILE_CLOSED_EVENT, getFiles, saveFile, updateFile, type OpenFile } from '@/features/files/store'
import { motionEnabled } from '@/features/panes/motion'
import { appendComposerDraft } from '@/features/engine/drafts'
import { QUOTE_SELECTION } from '@/features/layout/shortcuts'
import { composerTarget, focusComposer } from '@/features/session/composerTarget'
import {
  QUOTE_MAX_CHARS,
  QUOTE_MAX_LINES,
  quotePath,
  quoteRange,
  quoteText,
  quoteTooLong,
} from '@/features/session/quote'
import { isDemo } from '@/data'
import { tr } from '@/i18n/core'
import { useToast } from '@/ui'
import { ActionMenu, type MenuAction } from '@/ui/ActionMenu'
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
/** 编辑器实例数（内存遥测用） */
export const editorCount = (): number => runtimes.size
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
/**
 * 把这个文件里选中的几行（没有选中时是光标所在行）引用到会话输入框，光标跟过去（docs/ui/editor-quote.md）。
 * 成功返回 null；没有会话、太长时返回要提示的话
 */
export function quoteSelection(tabId: string): string | null {
  const runtime = runtimes.get(tabId),
    tab = getFiles().tabs.find(t => t.id === tabId)
  if (!runtime || !tab) return null
  const target = composerTarget()
  if (!target) return tr('editor.quote.noSession')
  const { state } = runtime.view
  const range = quoteRange(state.doc, state.selection.main.from, state.selection.main.to)
  const size = quoteTooLong(range)
  if (size)
    return tr('editor.quote.tooLong', {
      lines: size.lines,
      chars: size.chars,
      maxLines: QUOTE_MAX_LINES,
      maxChars: QUOTE_MAX_CHARS,
    })
  // 末尾换行：接着写问题时另起一行
  appendComposerDraft(target.key, quoteText(quotePath(tab, target.cwd), range) + '\n')
  focusComposer(target.key)
  return null
}

const clipboardWrite = (text: string): Promise<unknown> =>
  isDemo ? navigator.clipboard.writeText(text) : window.pixelsky!.terminal.clipboardWrite(text)
const clipboardRead = (): Promise<string> =>
  isDemo ? navigator.clipboard.readText() : window.pixelsky!.terminal.clipboardRead()

/** 右键菜单：引用到对话，再加上剪切、复制、粘贴、全选（编辑器原来没有右键菜单） */
function menuActions(tabId: string, view: EditorView, toast: (message: string) => void): MenuAction[] {
  const { state } = view
  const selected = state.selection.ranges.filter(r => !r.empty)
  const text = selected.map(r => state.sliceDoc(r.from, r.to)).join(state.lineBreak)
  const readonly = state.readOnly
  return [
    {
      label: tr('editor.quote.action'),
      icon: MessageSquareQuote,
      run: () => {
        const error = quoteSelection(tabId)
        if (error) toast(error)
      },
    },
    {
      label: tr('editor.menu.cut'),
      icon: Scissors,
      separator: true,
      disabled: readonly || !text,
      run: () => {
        void clipboardWrite(text).then(() => view.dispatch(state.replaceSelection(''), { userEvent: 'delete.cut' }))
      },
    },
    { label: tr('editor.menu.copy'), icon: Copy, disabled: !text, run: () => void clipboardWrite(text) },
    {
      label: tr('editor.menu.paste'),
      icon: ClipboardPaste,
      disabled: readonly,
      run: () => {
        void clipboardRead().then(value => {
          if (value)
            view.dispatch(view.state.replaceSelection(value), { userEvent: 'input.paste', scrollIntoView: true })
          view.focus()
        })
      },
    },
    {
      label: tr('editor.menu.selectAll'),
      icon: TextSelect,
      run: () => {
        view.dispatch({ selection: EditorSelection.single(0, state.doc.length) })
        view.focus()
      },
    },
  ]
}

export function CodeEditor({ tab, active, wordWrap = false }: { tab: OpenFile; active: boolean; wordWrap?: boolean }) {
  const { locale } = useI18n()
  const toast = useToast()
  const host = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
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
            // 引用到对话（默认 Ctrl+L）：放在快捷键表前面，盖过 CodeMirror 自带的 Ctrl+L（选中整行）；改了快捷键后 Ctrl+L 恢复选中整行
            Prec.high(
              EditorView.domEventHandlers({
                keydown(e) {
                  if (!QUOTE_SELECTION.match(e)) return false
                  e.preventDefault()
                  const error = quoteSelection(tab.id)
                  if (error) toast(error)
                  return true
                },
              }),
            ),
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
  const runtime = runtimes.get(tab.id)
  return (
    <>
      <div
        ref={host}
        data-code-editor={tab.id}
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
        onContextMenu={e => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      />
      {menu && runtime && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={tr('editor.menu.label')}
          actions={menuActions(tab.id, runtime.view, toast)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
