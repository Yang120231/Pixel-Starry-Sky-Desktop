// 粘贴段和撤销记录、外部改动（审查报告 2026-10-14）：段外打字不换数组；撤回放回来的段跟着中间的外部改动映射
import { describe, expect, it } from 'vitest'
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { history, invertedEffects, isolateHistory, undo } from '@codemirror/commands'
import { addPaste, pasteField, restoreEffects } from './pasteFold'

const block = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')

/** 和 ComposerInput 一样的扩展：被改动吞掉的段记成撤回时放回去的效果 */
const extensions = [pasteField, history(), invertedEffects.of(restoreEffects)]

function editor() {
  let state = EditorState.create({ doc: 'A  B', extensions })
  const apply = (spec: TransactionSpec) => (state = state.update(spec).state)
  apply({
    changes: { from: 2, insert: block },
    effects: addPaste.of({ id: 1, from: 2, to: 2 + block.length, folded: true }),
    userEvent: 'input.paste',
  })
  return {
    get state() {
      return state
    },
    apply,
    undo: () => undo({ state, dispatch: tr => (state = tr.state) }),
  }
}

describe('粘贴段', () => {
  it('在段后面打字：段的数组不变（不用每次按键都存、都重建装饰）', () => {
    const e = editor()
    const before = e.state.field(pasteField)
    e.apply({ changes: { from: e.state.doc.length, insert: 'xyz' } })
    expect(e.state.field(pasteField)).toBe(before)
  })
  it('删掉段、前面被别处插了字、再撤回：段放回到映射后的位置', () => {
    const e = editor()
    e.apply({
      changes: { from: 2, to: 2 + block.length },
      userEvent: 'delete.backward',
      annotations: isolateHistory.of('full'),
    })
    expect(e.state.field(pasteField)).toEqual([])
    // 外部改动（例如别处往草稿开头追加），不进撤销记录
    e.apply({ changes: { from: 0, insert: '>>' }, annotations: Transaction.addToHistory.of(false) })
    e.undo()
    const [chunk] = e.state.field(pasteField)
    expect(e.state.sliceDoc(chunk.from, chunk.to)).toBe(block)
  })
  it('删掉段、整个输入框被清空（发送）、再撤回：不会放一个越界的段', () => {
    const e = editor()
    e.apply({
      changes: { from: 2, to: 2 + block.length },
      userEvent: 'delete.backward',
      annotations: isolateHistory.of('full'),
    })
    e.apply({ changes: { from: 0, to: e.state.doc.length }, annotations: Transaction.addToHistory.of(false) })
    e.undo()
    for (const c of e.state.field(pasteField)) {
      expect(c.to).toBeLessThanOrEqual(e.state.doc.length)
      expect(e.state.sliceDoc(c.from, c.to)).toBe(block)
    }
  })
})
