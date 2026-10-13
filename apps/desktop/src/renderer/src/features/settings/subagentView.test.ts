import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBAGENT_VIEW, parseSubagentView } from './subagentView'

describe('子智能体显示方式', () => {
  it('默认是小框', () => {
    expect(DEFAULT_SUBAGENT_VIEW).toBe('box')
  })

  it('认得 box 和 inline，读不懂的值按默认', () => {
    expect(parseSubagentView('box')).toBe('box')
    expect(parseSubagentView('inline')).toBe('inline')
    for (const bad of [null, undefined, '', 'Box', 'both', 1, {}]) expect(parseSubagentView(bad)).toBe('box')
  })
})
