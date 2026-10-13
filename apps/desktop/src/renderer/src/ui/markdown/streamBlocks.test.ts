import { describe, expect, it } from 'vitest'
import { createStreamSplitter, splitStreamBlocks } from './streamBlocks'

const joined = (r: { completed: string[]; tail: string }): string => r.completed.join('') + r.tail

describe('splitStreamBlocks', () => {
  it('按空行切，最后一段是尾巴，拼起来等于原文', () => {
    const text = '第一段\n\n第二段\n\n第三段还在写'
    const r = splitStreamBlocks(text)
    expect(r.completed).toEqual(['第一段\n\n', '第二段\n\n'])
    expect(r.tail).toBe('第三段还在写')
    expect(joined(r)).toBe(text)
  })

  it('最后一个空行后只剩换行或空白时，尾巴也不算完成块', () => {
    expect(splitStreamBlocks('a\n').completed).toEqual([])
    expect(splitStreamBlocks('a\n\n').tail).toBe('')
    expect(splitStreamBlocks('a\n  ').completed).toEqual([])
  })

  it('连续空行不产生只有空行的块', () => {
    const r = splitStreamBlocks('a\n\n\n\nb\n\nc')
    expect(r.completed).toEqual(['a\n\n', '\n\nb\n\n'])
    expect(joined(r)).toBe('a\n\n\n\nb\n\nc')
  })

  it('围栏代码块里的空行不切', () => {
    const text = '前\n\n```js\na\n\nb\n```\n\n后'
    const r = splitStreamBlocks(text)
    expect(r.completed).toEqual(['前\n\n', '```js\na\n\nb\n```\n\n'])
    expect(r.tail).toBe('后')
  })

  it('围栏没闭合，从围栏起都是尾巴', () => {
    const r = splitStreamBlocks('前\n\n```\na\n\nb\n\nc')
    expect(r.completed).toEqual(['前\n\n'])
    expect(r.tail).toBe('```\na\n\nb\n\nc')
  })

  it('~~~ 围栏；更长的围栏里短围栏不算闭合', () => {
    expect(splitStreamBlocks('~~~\na\n\nb\n~~~\n\nx').completed).toEqual(['~~~\na\n\nb\n~~~\n\n'])
    const r = splitStreamBlocks('````\n```\n\nx\n````\n\ny')
    expect(r.completed).toEqual(['````\n```\n\nx\n````\n\n'])
    expect(splitStreamBlocks('```\na\n~~~\n\nb').completed).toEqual([])
  })

  it('CRLF 文字', () => {
    const text = 'a\r\n\r\n```\r\nx\r\n\r\ny\r\n```\r\n\r\nz'
    const r = splitStreamBlocks(text)
    expect(r.completed).toEqual(['a\r\n\r\n', '```\r\nx\r\n\r\ny\r\n```\r\n\r\n'])
    expect(r.tail).toBe('z')
  })

  it('没有空行全是尾巴', () => {
    const text = 'x\n'.repeat(1000)
    const r = splitStreamBlocks(text)
    expect(r.completed).toEqual([])
    expect(r.tail).toBe(text)
  })

  it('接着写，已完成的块内容不变', () => {
    const a = 'p1\n\n```\nc\n\nd\n```\n\np2\n\np3'
    const b = a + ' 更多\n\np4\n\n'
    const ra = splitStreamBlocks(a)
    const rb = splitStreamBlocks(b)
    expect(rb.completed.slice(0, ra.completed.length)).toEqual(ra.completed)
    expect(rb.completed.length).toBeGreaterThan(ra.completed.length)
  })
})

describe('缩进的围栏和增量切块', () => {
  it('列表项里缩进 4 格的围栏，里面的空行不切', () => {
    const text = '1. 安装\n\n    ```bash\n    npm i\n\n    npm test\n    ```\n\n2. 下一步\n\n后面'
    const r = splitStreamBlocks(text)
    expect(r.completed).toEqual(['1. 安装\n\n', '    ```bash\n    npm i\n\n    npm test\n    ```\n\n', '2. 下一步\n\n'])
    expect(r.tail).toBe('后面')
  })

  it('逐字追加和一次性切分结果一致', () => {
    const text = 'p1\n\n```\nc\n\nd\n```\r\n\r\n  ~~~\nx\n\n~~~\n\np2 还在\n写'
    const split = createStreamSplitter()
    for (let i = 1; i <= text.length; i++) {
      expect(split(text.slice(0, i))).toEqual(splitStreamBlocks(text.slice(0, i)))
    }
  })

  it('文字对不上上一次时从头切', () => {
    const split = createStreamSplitter()
    split('a\n\nb\n\nc')
    expect(split('x\n\ny')).toEqual({ completed: ['x\n\n'], tail: 'y' })
  })
})
