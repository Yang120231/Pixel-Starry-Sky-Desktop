// 会话输入框的右键菜单（scratch/2026-10-14-context-menu/plan.md 第一批）：撤销、重做、剪切、复制、粘贴、
// 粘贴为纯文本（不折成标签）、全选；点在折起 / 展开的粘贴段上时多一项展开 / 折起
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  ClipboardType,
  Copy,
  Redo2,
  Scissors,
  TextSelect,
  Undo2,
} from 'lucide-react'
import { tr } from '@/i18n/core'
import type { MenuAction } from '@/ui/ActionMenu'
import { pasteField, setFolded } from '../composerInput/pasteFold'
import { clipboardRead, clipboardWrite } from './clipboard'

/** 粘贴：plain 为真时不折叠（同 Ctrl+Shift+V）。ComposerInput 的粘贴事件和菜单共用 */
export type InsertPaste = (view: EditorView, raw: string, plain: boolean) => void

/** at：右键点到的文字位置（键盘打开时是光标），用来找粘贴段 */
export function composerMenuActions(view: EditorView, at: number, insertPaste: InsertPaste): MenuAction[] {
  const { state } = view
  const ranges = state.selection.ranges.filter(r => !r.empty)
  const text = ranges.map(r => state.sliceDoc(r.from, r.to)).join('\n')
  const done = (): void => view.focus()
  const paste = (plain: boolean) => (): void =>
    void clipboardRead()
      .then(value => {
        if (value) insertPaste(view, value, plain)
      })
      .finally(done)
  const actions: MenuAction[] = [
    { label: tr('ctxmenu.undo'), icon: Undo2, disabled: undoDepth(state) === 0, run: () => (undo(view), done()) },
    { label: tr('ctxmenu.redo'), icon: Redo2, disabled: redoDepth(state) === 0, run: () => (redo(view), done()) },
    {
      label: tr('ctxmenu.cut'),
      icon: Scissors,
      separator: true,
      disabled: !text,
      run: () =>
        void clipboardWrite(text).then(() => {
          view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut' })
          done()
        }),
    },
    { label: tr('ctxmenu.copy'), icon: Copy, disabled: !text, run: () => void clipboardWrite(text).then(done) },
    { label: tr('ctxmenu.paste'), icon: ClipboardPaste, run: paste(false) },
    { label: tr('ctxmenu.pastePlain'), icon: ClipboardType, run: paste(true) },
    {
      label: tr('ctxmenu.selectAll'),
      icon: TextSelect,
      run: () => {
        view.dispatch({ selection: EditorSelection.single(0, state.doc.length) })
        done()
      },
    },
  ]
  const chunk = state.field(pasteField).find(c => c.from <= at && at <= c.to)
  if (chunk)
    actions.push({
      label: tr(chunk.folded ? 'ctxmenu.pasteExpand' : 'ctxmenu.pasteCollapse'),
      icon: chunk.folded ? ChevronsUpDown : ChevronsDownUp,
      separator: true,
      run: () => {
        view.dispatch({ effects: setFolded.of({ id: chunk.id, folded: !chunk.folded }) })
        done()
      },
    })
  return actions
}
