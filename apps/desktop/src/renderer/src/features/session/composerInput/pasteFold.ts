// 输入框里粘贴的长文本（docs/ui/composer-paste-fold.md）：哪几段是粘贴的、折没折。纯状态，不碰 DOM，可单测
import { StateEffect, StateField, type ChangeDesc } from '@codemirror/state'

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
export function mapChunks(chunks: readonly PasteChunk[], changes: ChangeDesc): PasteChunk[] {
  const next: PasteChunk[] = []
  for (const c of chunks) {
    const from = changes.mapPos(c.from, 1)
    const to = changes.mapPos(c.to, -1)
    if (to > from) next.push(from === c.from && to === c.to ? c : { ...c, from, to })
  }
  return next
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
/** 折起 / 展开一段 */
export const setFolded = StateEffect.define<{ id: number; folded: boolean }>()
/** 整个换掉（读回草稿的记录） */
export const resetPastes = StateEffect.define<readonly unknown[]>()

export const pasteField = StateField.define<readonly PasteChunk[]>({
  create: () => [],
  update(chunks, tr) {
    let next = tr.docChanged ? mapChunks(chunks, tr.changes) : chunks
    for (const effect of tr.effects) {
      if (effect.is(addPaste)) {
        // 撤回时放回来的段编号可能已经被新段用了，换一个
        const id = next.some(c => c.id === effect.value.id) ? nextPasteId(next) : effect.value.id
        next = [...next, { ...effect.value, id }].sort((a, b) => a.from - b.from)
      } else if (effect.is(setFolded))
        next = next.map(c => (c.id === effect.value.id ? { ...c, folded: effect.value.folded } : c))
      else if (effect.is(resetPastes)) next = validChunks(effect.value, tr.state.doc.length)
    }
    return next
  },
})
