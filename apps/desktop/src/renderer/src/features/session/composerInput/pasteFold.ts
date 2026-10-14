// 输入框里粘贴的长文本（docs/ui/composer-paste-fold.md）：哪几段是粘贴的、折没折。纯状态，不碰 DOM，可单测
import { StateEffect, StateField, type ChangeDesc, type Transaction } from '@codemirror/state'

/** 一段粘贴：[from, to) 是它在输入框文字里的范围 */
export interface PasteChunk {
  /** 编号（#1、#2…） */
  id: number
  from: number
  to: number
  folded: boolean
}

/** 一次粘贴这么多行或这么多字就折成标签 */
export const FOLD_MIN_LINES = 8
export const FOLD_MIN_CHARS = 800

/** 去掉开头结尾的空行（只去整行空白，不动行内的缩进） */
export function trimBlankLines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '')
}

export const lineCount = (text: string): number => (text ? text.split('\n').length : 0)

/** 粘贴的文字（已去掉首尾空行）要不要折 */
export const shouldFold = (text: string): boolean => lineCount(text) >= FOLD_MIN_LINES || text.length >= FOLD_MIN_CHARS

/** 下一个编号：一个标签都没有时从 1 开始 */
export const nextPasteId = (chunks: readonly PasteChunk[]): number =>
  chunks.length ? Math.max(...chunks.map(c => c.id)) + 1 : 1

/** 标签上的量：多行写行数，一行写字数 */
export function chunkSize(text: string): { unit: 'lines' | 'chars'; count: number } {
  const lines = lineCount(text)
  return lines > 1 ? { unit: 'lines', count: lines } : { unit: 'chars', count: text.length }
}

/** 鼠标停在标签上时看的前几行 */
export function chunkPreview(text: string, maxLines = 6, maxChars = 80): string {
  const lines = text.split('\n')
  const head = lines.slice(0, maxLines).map(l => (l.length > maxChars ? `${l.slice(0, maxChars)}…` : l))
  if (lines.length > maxLines) head.push('…')
  return head.join('\n')
}

/** 改动后的范围：段前面紧挨着打的字算段外，段后面紧挨着的也算段外；删光了就没了 */
export function mapChunks(chunks: readonly PasteChunk[], changes: ChangeDesc): readonly PasteChunk[] {
  const next: PasteChunk[] = []
  let same = true
  for (const c of chunks) {
    const from = changes.mapPos(c.from, 1)
    const to = changes.mapPos(c.to, -1)
    if (to > from) next.push(from === c.from && to === c.to ? c : { ...c, from, to })
    if (to <= from || from !== c.from || to !== c.to) same = false
  }
  // 段都没动（在段后面打字、没有段）：返回原数组，后面「段变了才存、才重建装饰」靠这个判断
  return same ? chunks : next
}

/** 读回来的记录：范围要在文字里、互不重叠，编号不重复；不对的丢掉 */
export function validChunks(chunks: readonly unknown[], length: number): PasteChunk[] {
  const ok: PasteChunk[] = []
  const ids = new Set<number>()
  const sorted = chunks
    .filter((c): c is PasteChunk => {
      const v = c as Partial<PasteChunk> | null
      return (
        !!v &&
        Number.isInteger(v.id) &&
        Number.isInteger(v.from) &&
        Number.isInteger(v.to) &&
        typeof v.folded === 'boolean' &&
        v.id! > 0 &&
        v.from! >= 0 &&
        v.to! > v.from! &&
        v.to! <= length
      )
    })
    .sort((a, b) => a.from - b.from)
  let end = 0
  for (const c of sorted) {
    if (c.from < end || ids.has(c.id)) continue
    ids.add(c.id)
    ok.push({ id: c.id, from: c.from, to: c.to, folded: c.folded })
    end = c.to
  }
  return ok
}

/** 新加一段（范围是改动之后的位置） */
export const addPaste = StateEffect.define<PasteChunk>()

/**
 * 撤回时放回被删掉的段。不记绝对位置：撤销记录会用「撤回前」的坐标映射效果，和段「撤回后」的位置对不上，
 * 中间有外部改动（发送后清空、别处追加草稿）时标签会盖错地方（审查报告 2026-10-14）。
 * 改记它在被删掉的那一截文字里的偏移和那一截的长度：撤回时在撤回的改动里找到插回来的那一截，再按偏移放回去
 */
export interface RestoredPaste {
  chunk: PasteChunk
  /** 段开头在被删掉那一截里的偏移 */
  offset: number
  /** 被删掉那一截的长度 */
  span: number
}
export const restorePaste = StateEffect.define<RestoredPaste>()

/** invertedEffects 用：这次改动吞掉的段，记成撤回时放回去的效果 */
export function restoreEffects(tr: Transaction): StateEffect<RestoredPaste>[] {
  if (!tr.docChanged) return []
  const alive = new Set(tr.state.field(pasteField).map(c => c.id))
  const out: StateEffect<RestoredPaste>[] = []
  for (const chunk of tr.startState.field(pasteField)) {
    if (alive.has(chunk.id)) continue
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= chunk.from && chunk.to <= toA)
        out.push(restorePaste.of({ chunk, offset: chunk.from - fromA, span: toA - fromA }))
    })
  }
  return out
}
/** 折起 / 展开一段 */
export const setFolded = StateEffect.define<{ id: number; folded: boolean }>()
/** 整个换掉（读回草稿的记录） */
export const resetPastes = StateEffect.define<readonly unknown[]>()

export const pasteField = StateField.define<readonly PasteChunk[]>({
  create: () => [],
  update(chunks, tr) {
    let next = tr.docChanged ? mapChunks(chunks, tr.changes) : chunks
    for (const effect of tr.effects) {
      let add: PasteChunk | null = null
      if (effect.is(addPaste)) add = effect.value
      else if (effect.is(restorePaste)) {
        // 在这次（撤回的）改动里找插回来的那一截
        const { chunk, offset, span } = effect.value
        let start = -1
        tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
          if (start < 0 && toB - fromB === span) start = fromB
        })
        if (start >= 0) add = { ...chunk, from: start + offset, to: start + offset + (chunk.to - chunk.from) }
      }
      if (add) {
        const { from, to } = add
        // 范围不在文字里、或和已有的段重叠：不放（不让标签盖在不对的地方，也免得装饰越界出错）
        if (from < 0 || to > tr.state.doc.length || to <= from || next.some(c => c.from < to && from < c.to)) continue
        // 撤回时放回来的段编号可能已经被新段用了，换一个
        const id = next.some(c => c.id === add.id) ? nextPasteId(next) : add.id
        next = [...next, { ...add, id }].sort((a, b) => a.from - b.from)
      } else if (effect.is(setFolded))
        next = next.map(c => (c.id === effect.value.id ? { ...c, folded: effect.value.folded } : c))
      else if (effect.is(resetPastes)) next = validChunks(effect.value, tr.state.doc.length)
    }
    return next
  },
})
