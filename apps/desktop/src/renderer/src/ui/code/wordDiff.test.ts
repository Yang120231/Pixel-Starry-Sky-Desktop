import { describe, expect, it } from 'vitest'
import { cutSegments, pairRanges, tokenize, wordDiffRanges } from './wordDiff'

const pick = (text: string, ranges: { start: number; end: number }[]) => ranges.map(r => text.slice(r.start, r.end))

describe('tokenize', () => {
  it('单词、空白、符号分开，中日韩字符一个字一个词', () => {
    expect(tokenize('foo(bar, 2)')).toEqual(['foo', '(', 'bar', ',', ' ', '2', ')'])
    expect(tokenize('修改abc文件')).toEqual(['修', '改', 'abc', '文', '件'])
  })
})

describe('pairRanges', () => {
  it('只标出变化的词', () => {
    const before = 'const total = price * count'
    const after = 'const total = price * quantity'
    const r = pairRanges(before, after)!
    expect(pick(before, r.removed)).toEqual(['count'])
    expect(pick(after, r.added)).toEqual(['quantity'])
  })

  it('中间只隔空白的两段变化并成一段', () => {
    const r = pairRanges('return a b', 'return x y')!
    expect(pick('return x y', r.added)).toEqual(['x y'])
  })

  it('中文按字比较', () => {
    const r = pairRanges('打开文件', '关闭文件')!
    expect(pick('打开文件', r.removed)).toEqual(['打开'])
    expect(pick('关闭文件', r.added)).toEqual(['关闭'])
  })

  it('整行重写、相同、过长时不做', () => {
    expect(pairRanges('alpha beta', 'gamma delta')).toBeNull()
    expect(pairRanges('same', 'same')).toBeNull()
    expect(pairRanges('x'.repeat(501) + ' a', 'x'.repeat(501) + ' b')).toBeNull()
  })
})

describe('wordDiffRanges', () => {
  it('相邻的删除段和增加段按位置配对，多出来的行不配', () => {
    const lines = [
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-let a = 1',
      '-let b = 2',
      '+let a = 10',
      '+let b = 2;',
      '+extra',
      ' tail',
    ]
    const map = wordDiffRanges(lines)
    expect(pick('let a = 1', map.get(2)!)).toEqual(['1'])
    expect(pick('let a = 10', map.get(4)!)).toEqual(['10'])
    expect(map.has(3)).toBe(false) // 只多了分号：删除行这边没有变化
    expect(pick('let b = 2;', map.get(5)!)).toEqual([';'])
    expect(map.has(6)).toBe(false)
  })

  it('文件头 ---/+++ 不参与', () => {
    expect(wordDiffRanges(['--- a/x.ts', '+++ b/x.ts']).size).toBe(0)
  })
})

describe('cutSegments', () => {
  it('按区间切开语法高亮片段', () => {
    const segs = [
      { text: 'const ', className: 'hljs-keyword' },
      { text: 'value', className: null },
    ]
    expect(cutSegments(segs, [{ start: 4, end: 8 }])).toEqual([
      { text: 'cons', className: 'hljs-keyword', changed: false },
      { text: 't ', className: 'hljs-keyword', changed: true },
      { text: 'va', className: null, changed: true },
      { text: 'lue', className: null, changed: false },
    ])
  })
})
