import { describe, expect, it } from 'vitest'
import { REQUEST_MS, expandItems, expandRequest, freshRequest } from './expand'

describe('expandItems', () => {
  it('只对对应会话的条目生效', () => {
    expandItems('s1', ['a', 'b'], 1000)
    expect(expandRequest('s1', 'a')).toEqual({ n: 1, at: 1000 })
    expect(expandRequest('s1', 'b')).toEqual({ n: 1, at: 1000 })
    expect(expandRequest('s2', 'a')).toBeNull()
    expect(expandRequest(null, 'a')).toBeNull()
  })
  it('重复请求是新对象，次数加一', () => {
    expandItems('s3', ['x'], 1000)
    const first = expandRequest('s3', 'x')
    expandItems('s3', ['x'], 2000)
    const second = expandRequest('s3', 'x')
    expect(second).not.toBe(first)
    expect(second).toEqual({ n: 2, at: 2000 })
  })
  it('空列表不登记', () => {
    expandItems('s4', [])
    expect(expandRequest('s4', 'x')).toBeNull()
  })
})

describe('freshRequest', () => {
  it('过期的请求不再展开（很久以后重新挂载）', () => {
    expect(freshRequest({ n: 1, at: 0 }, REQUEST_MS - 1)).toBe(true)
    expect(freshRequest({ n: 1, at: 0 }, REQUEST_MS)).toBe(false)
    expect(freshRequest(null)).toBe(false)
  })
})
