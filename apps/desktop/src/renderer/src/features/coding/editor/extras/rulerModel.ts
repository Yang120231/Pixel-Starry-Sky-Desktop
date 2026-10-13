// 概览标尺的换算（纯函数）：行号 <-> 标尺上的位置
export type RulerKind = 'added' | 'modified' | 'deleted'
export interface RulerChange {
  line: number
  kind: RulerKind
}
export interface RulerMark {
  kind: RulerKind
  fromLine: number
  toLine: number
  /** 相对标尺顶端的像素 */
  top: number
  height: number
}
export const RULER_MIN_MARK = 3

/** 把逐行的改动合并成连续的刻度；位置按行号占总行数的比例换算 */
export function rulerMarks(changes: readonly RulerChange[], totalLines: number, trackHeight: number): RulerMark[] {
  if (totalLines <= 0 || trackHeight <= 0 || !changes.length) return []
  const sorted = [...changes].sort((a, b) => a.line - b.line)
  const runs: Array<{ kind: RulerKind; fromLine: number; toLine: number }> = []
  for (const c of sorted) {
    const last = runs[runs.length - 1]
    if (last && last.kind === c.kind && c.line <= last.toLine + 1) last.toLine = Math.max(last.toLine, c.line)
    else runs.push({ kind: c.kind, fromLine: c.line, toLine: c.line })
  }
  return runs.map(run => {
    const top = ((run.fromLine - 1) / totalLines) * trackHeight
    const height = Math.max(RULER_MIN_MARK, ((run.toLine - run.fromLine + 1) / totalLines) * trackHeight)
    return { ...run, top: Math.min(top, Math.max(0, trackHeight - height)), height }
  })
}

/** 可视区域在标尺上的方块 */
export function viewportBox(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  trackHeight: number,
): { top: number; height: number } {
  if (scrollHeight <= 0 || trackHeight <= 0) return { top: 0, height: 0 }
  const height = Math.min(trackHeight, Math.max(6, (clientHeight / scrollHeight) * trackHeight))
  const top = Math.min(trackHeight - height, Math.max(0, (scrollTop / scrollHeight) * trackHeight))
  return { top, height }
}

/** 标尺上 y 位置对应的行号（1 起，夹在文件范围里） */
export function lineAtRatio(y: number, trackHeight: number, totalLines: number): number {
  if (totalLines <= 0 || trackHeight <= 0) return 1
  const line = Math.floor((y / trackHeight) * totalLines) + 1
  return Math.min(totalLines, Math.max(1, line))
}
