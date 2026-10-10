import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { currentTurn, maxTicks, sampleTurns, turnsOf } from './turnRailModel'

const user = (id: string, text: string, mode?: 'guidance'): Item => ({ kind: 'user', id, text, createdAt: 0, mode })

describe('轮次跳转条', () => {
  it('每条我方消息一轮，引导消息不算；预览取第一行，太长截断', () => {
    const turns = turnsOf([
      user('a', '  第一句\n第二行'),
      { kind: 'assistant', id: 'x', text: '好', status: 'completed' } as Item,
      user('g', '插话', 'guidance'),
      user('b', '长'.repeat(70)),
    ])
    expect(turns.map(t => [t.id, t.n])).toEqual([
      ['a', 1],
      ['b', 2],
    ])
    expect(turns[0].preview).toBe('第一句')
    expect(turns[1].preview).toBe(`${'长'.repeat(60)}…`)
  })

  it('放得下就全画；放不下时抽样，首尾和当前轮都在', () => {
    expect(sampleTurns(5, 10, 2)).toEqual([0, 1, 2, 3, 4])
    const picked = sampleTurns(200, 20, 137)
    expect(picked).toHaveLength(20)
    expect(picked).toEqual(expect.arrayContaining([0, 137, 199]))
    expect([...picked].sort((a, b) => a - b)).toEqual(picked)
    expect(maxTicks(300)).toBe(100)
  })

  it('当前轮：滚过视口顶部的最后一轮', () => {
    expect(currentTurn([0, 500, 1200], 0)).toBe(0)
    expect(currentTurn([0, 500, 1200], 480)).toBe(1)
    expect(currentTurn([0, 500, 1200], 2000)).toBe(2)
    expect(currentTurn([100, 500], 0)).toBe(0)
  })
})
