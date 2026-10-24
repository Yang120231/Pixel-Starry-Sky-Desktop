import { describe, expect, it } from 'vitest'
import type { ArtifactDelivery, ArtifactFile, ArtifactTurn } from '@pixelsky/protocol'
import { groupBySession } from './artifactsModel'
import {
  EMPTY_FOLD,
  collapseAll,
  expandAll,
  groupDelivered,
  readFold,
  revealTurn,
  sessionOpen,
  toggleSession,
  toggleTurn,
  turnOpen,
  turnsSummary,
} from './fold'

const file = (added: number, removed: number) => ({ added, removed }) as ArtifactFile
const turn = (sessionId: string, at: number, files: ArtifactFile[] = []): ArtifactTurn => ({
  sessionId,
  title: sessionId,
  engine: 'claude',
  archived: false,
  userItemId: 'u' + at,
  prompt: '',
  at,
  files,
})

describe('产物面板伸缩', () => {
  const groups = groupBySession([turn('a', 1), turn('a', 9), turn('b', 5)])
  const [a, b] = groups

  it('默认会话都展开，每个会话只展开最新的一轮', () => {
    expect(sessionOpen(EMPTY_FOLD, 'a')).toBe(true)
    expect(a.turns.map(t => turnOpen(EMPTY_FOLD, a, t))).toEqual([true, false])
    expect(turnOpen(EMPTY_FOLD, b, b.turns[0])).toBe(true)
  })

  it('点过的轮按点的；新来的一轮仍默认展开', () => {
    let s = toggleTurn(EMPTY_FOLD, a, a.turns[1])
    s = toggleTurn(s, a, a.turns[0])
    expect(a.turns.map(t => turnOpen(s, a, t))).toEqual([false, true])
    const later = groupBySession([turn('a', 1), turn('a', 9), turn('a', 20)])[0]
    expect(later.turns.map(t => turnOpen(s, later, t))).toEqual([true, false, true])
  })

  it('全部展开 / 全部收起；收起后各轮记的状态不丢', () => {
    let s = toggleTurn(EMPTY_FOLD, a, a.turns[0])
    s = collapseAll(s, groups)
    expect([sessionOpen(s, 'a'), sessionOpen(s, 'b')]).toEqual([false, false])
    expect(turnOpen(toggleSession(s, 'a'), a, a.turns[0])).toBe(false)
    s = expandAll(s, groups)
    expect([sessionOpen(s, 'a'), sessionOpen(s, 'b')]).toEqual([true, true])
    expect(a.turns.every(t => turnOpen(s, a, t))).toBe(true)
  })

  it('「审查」定位的那一轮和它的会话都展开', () => {
    const s = revealTurn(collapseAll(EMPTY_FOLD, groups), a.turns[1])
    expect(sessionOpen(s, 'a')).toBe(true)
    expect(sessionOpen(s, 'b')).toBe(false)
    expect(turnOpen(s, a, a.turns[1])).toBe(true)
  })

  it('读本机存的值：坏字段当没有', () => {
    expect(readFold(null)).toEqual(EMPTY_FOLD)
    expect(readFold({ closed: ['a', 3], turns: { x: true, y: 'no' }, closedDelivered: 'b' })).toEqual({
      closed: ['a'],
      turns: { x: true },
      closedDelivered: [],
    })
  })

  it('交付按会话分组、倒序；收起时的摘要', () => {
    const d = (sessionId: string, at: number) => ({ sessionId, title: sessionId, at }) as ArtifactDelivery
    expect(groupDelivered([d('a', 1), d('b', 5), d('a', 9)]).map(g => [g.sessionId, g.items.map(i => i.at)])).toEqual([
      ['a', [9, 1]],
      ['b', [5]],
    ])
    expect(turnsSummary([turn('a', 1, [file(3, 1), file(2, 0)]), turn('a', 2, [file(1, 4)])])).toEqual({
      files: 3,
      added: 6,
      removed: 5,
    })
  })
})
