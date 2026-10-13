import { describe, expect, it } from 'vitest'
import { RULER_MIN_MARK, lineAtRatio, rulerMarks, viewportBox } from './rulerModel'

describe('rulerMarks', () => {
  it('相邻同类的行合成一个刻度，位置按行号比例换算', () => {
    const marks = rulerMarks(
      [
        { line: 11, kind: 'added' },
        { line: 12, kind: 'added' },
        { line: 51, kind: 'modified' },
      ],
      100,
      200,
    )
    expect(marks).toEqual([
      { kind: 'added', fromLine: 11, toLine: 12, top: 20, height: 4 },
      { kind: 'modified', fromLine: 51, toLine: 51, top: 100, height: RULER_MIN_MARK },
    ])
  })
  it('不同类的相邻行分开，输入乱序也行', () => {
    const marks = rulerMarks(
      [
        { line: 3, kind: 'modified' },
        { line: 2, kind: 'added' },
      ],
      10,
      100,
    )
    expect(marks.map(m => m.kind)).toEqual(['added', 'modified'])
  })
  it('太小的刻度至少 3px，且不会超出标尺底部', () => {
    const [m] = rulerMarks([{ line: 1000, kind: 'deleted' }], 1000, 100)
    expect(m.height).toBe(RULER_MIN_MARK)
    expect(m.top + m.height).toBeLessThanOrEqual(100)
  })
  it('没有改动或没有尺寸时为空', () => {
    expect(rulerMarks([], 10, 100)).toEqual([])
    expect(rulerMarks([{ line: 1, kind: 'added' }], 0, 100)).toEqual([])
    expect(rulerMarks([{ line: 1, kind: 'added' }], 10, 0)).toEqual([])
  })
})

describe('viewportBox', () => {
  it('按滚动比例换算', () => {
    expect(viewportBox(500, 500, 2000, 400)).toEqual({ top: 100, height: 100 })
  })
  it('夹在标尺里，内容比窗口短时占满', () => {
    expect(viewportBox(0, 500, 300, 400)).toEqual({ top: 0, height: 400 })
    const b = viewportBox(1500, 500, 2000, 400)
    expect(b.top + b.height).toBeLessThanOrEqual(400)
  })
  it('没内容时为 0', () => {
    expect(viewportBox(0, 0, 0, 400)).toEqual({ top: 0, height: 0 })
  })
})

describe('lineAtRatio', () => {
  it('位置换行号并夹取', () => {
    expect(lineAtRatio(0, 200, 100)).toBe(1)
    expect(lineAtRatio(100, 200, 100)).toBe(51)
    expect(lineAtRatio(999, 200, 100)).toBe(100)
    expect(lineAtRatio(-5, 200, 100)).toBe(1)
    expect(lineAtRatio(10, 200, 0)).toBe(1)
  })
})
