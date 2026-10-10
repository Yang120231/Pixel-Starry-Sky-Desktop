import { describe, expect, it } from 'vitest'
import { hasAnsi, parseAnsi, stripAnsi } from './ansi'

const ESC = '\u001b'

describe('parseAnsi', () => {
  it('16 色前景、背景、粗体和重置', () => {
    const spans = parseAnsi(`${ESC}[32mPASS${ESC}[0m ok ${ESC}[1;91mFAIL${ESC}[22;39m end ${ESC}[44mbg${ESC}[49m`)
    expect(spans.map(s => [s.text, s.fg, s.bg, s.bold])).toEqual([
      ['PASS', 2, null, false],
      [' ok ', null, null, false],
      ['FAIL', 9, null, true],
      [' end ', null, null, false],
      ['bg', null, 4, false],
    ])
  })

  it('38;5 只认前 16 色，真彩色忽略但不吃掉后面的参数', () => {
    expect(parseAnsi(`${ESC}[38;5;3mA${ESC}[38;5;200mB`).map(s => [s.text, s.fg])).toEqual([
      ['A', 3],
      ['B', null],
    ])
    expect(parseAnsi(`${ESC}[38;2;255;0;0;4mC`)[0]).toMatchObject({ text: 'C', fg: null, underline: true })
  })

  it('光标移动、OSC 超链接、退格等去掉，只留文字', () => {
    const text = `${ESC}[2K${ESC}[1Gdone ${ESC}]8;;https://x.dev${ESC}\\link${ESC}]8;;${ESC}\\ ok\u0007`
    expect(stripAnsi(text)).toBe('done link ok')
  })

  it('\\r 覆盖只保留最后一次，Windows 换行不受影响', () => {
    expect(stripAnsi('10%\r50%\r100% done\nnext\r\n')).toBe('100% done\nnext\n')
  })

  it('样式跨行保持，相邻同样式合并', () => {
    const spans = parseAnsi(`${ESC}[33ma\nb${ESC}[33mc`)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ text: 'a\nbc', fg: 3 })
  })
})

describe('hasAnsi', () => {
  it('没有控制序列的输出不用处理', () => {
    expect(hasAnsi('plain output\nline 2')).toBe(false)
    expect(hasAnsi(`${ESC}[0m`)).toBe(true)
    expect(hasAnsi('a\rb')).toBe(true)
  })
})
