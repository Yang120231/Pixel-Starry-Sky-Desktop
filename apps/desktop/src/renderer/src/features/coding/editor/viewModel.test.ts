import { describe, expect, it } from 'vitest'
import { effectiveBase, effectiveMode, viewAvailability, type ViewInput } from './viewModel'

const base: ViewInput = { head: 'a', draft: 'b', text: true, turnBaseline: null, width: 800, splitMinWidth: 560 }

describe('viewAvailability', () => {
  it('有 HEAD 且有改动时三种视图都能点', () => {
    expect(viewAvailability(base)).toMatchObject({ diff: true, split: true, turn: false, reason: null })
  })
  it('没有 HEAD 时变更和并排不能点', () => {
    expect(viewAvailability({ ...base, head: null })).toMatchObject({ diff: false, split: false, reason: 'noHead' })
  })
  it('二进制文件不能点', () => {
    expect(viewAvailability({ ...base, text: false })).toMatchObject({ diff: false, reason: 'binary' })
  })
  it('没有改动且算不出这一轮的基准时不能点', () => {
    expect(viewAvailability({ ...base, draft: 'a' })).toMatchObject({ diff: false, reason: 'noChange' })
  })
  it('没有改动但能算出这一轮的基准时能点', () => {
    expect(viewAvailability({ ...base, draft: 'a', turnBaseline: 'z' })).toMatchObject({ diff: true, turn: true })
  })
  it('基准是空字符串（新文件）也算能算出', () => {
    expect(viewAvailability({ ...base, turnBaseline: '' }).turn).toBe(true)
  })
  it('太窄时并排不能点，变更还能点', () => {
    expect(viewAvailability({ ...base, width: 400 })).toMatchObject({ diff: true, split: false, narrow: true })
  })
})

describe('effectiveMode / effectiveBase', () => {
  it('不可用的视图退回代码', () => {
    const none = viewAvailability({ ...base, head: null })
    expect(effectiveMode('diff', none)).toBe('code')
    expect(effectiveMode('split', none)).toBe('code')
  })
  it('太窄的并排退回变更', () => {
    expect(effectiveMode('split', viewAvailability({ ...base, width: 300 }))).toBe('diff')
  })
  it('只看这一轮算不出时退回 HEAD', () => {
    expect(effectiveBase('turn', viewAvailability(base))).toBe('head')
    expect(effectiveBase('turn', viewAvailability({ ...base, turnBaseline: 'x' }))).toBe('turn')
    expect(effectiveBase('head', viewAvailability(base))).toBe('head')
  })
})
