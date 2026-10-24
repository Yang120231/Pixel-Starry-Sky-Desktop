import { describe, expect, it } from 'vitest'
import { isTurnReviewed, markReviewed, markTurnReviewed, reviewedOf } from './reviewStore'

describe('整轮「全部保留」按版本记', () => {
  it('标记后同一版本算已保留，所有文件的块都算已审查', () => {
    markTurnReviewed('s-a', 'u1', 'e2')
    expect(isTurnReviewed('s-a', 'u1', 'e2')).toBe(true)
    expect(reviewedOf('s-a:u1:src/a.ts', 'e2')).toBe('all')
    expect(reviewedOf('s-a:u1:src/b.ts', 'e2')).toBe('all')
  })

  it('标记之后又有新改动（版本变了，例如断线重连的「继续」）：卡片和编辑器都回到未保留', () => {
    markTurnReviewed('s-b', 'u1', 'e2')
    expect(isTurnReviewed('s-b', 'u1', 'e3')).toBe(false)
    const after = reviewedOf('s-b:u1:src/a.ts', 'e3')
    expect(after).not.toBe('all')
    expect((after as ReadonlySet<string>).size).toBe(0)
    // 再点一次「全部保留」记下新版本
    markTurnReviewed('s-b', 'u1', 'e3')
    expect(isTurnReviewed('s-b', 'u1', 'e3')).toBe(true)
    expect(reviewedOf('s-b:u1:src/a.ts', 'e3')).toBe('all')
  })

  it('别的轮、别的会话、没有会话不受影响；单块标记照旧', () => {
    markTurnReviewed('s-c', 'u1', 'e1')
    expect(isTurnReviewed('s-c', 'u2', 'e1')).toBe(false)
    expect(isTurnReviewed('s-d', 'u1', 'e1')).toBe(false)
    expect(isTurnReviewed(null, 'u1', 'e1')).toBe(false)
    markReviewed('s-c:u2:a.ts', ['h1'])
    expect([...(reviewedOf('s-c:u2:a.ts', 'e1') as ReadonlySet<string>)]).toEqual(['h1'])
  })
})
