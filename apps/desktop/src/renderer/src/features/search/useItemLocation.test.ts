import { describe, expect, it, vi } from 'vitest'

vi.mock('@/ui', () => ({ useToast: () => () => undefined }))
vi.mock('../../i18n/core', () => ({ tr: (key: string) => key }))

import { REQUEST_MS, expandItems, expandRequest, freshRequest } from './expand'
import { beginLocate } from './useItemLocation'

const target = { sessionId: 's1', itemId: 'i1', terms: [], token: 1 }

describe('beginLocate', () => {
  it('快照晚于 5 秒才就绪：开始定位时刷新展开请求', () => {
    expandItems('s1', ['i1'], 0)
    expect(freshRequest(expandRequest('s1', 'i1'), REQUEST_MS + 1000)).toBe(false)
    expect(beginLocate(target, 's1', true, REQUEST_MS + 1000)).toBe(true)
    expect(freshRequest(expandRequest('s1', 'i1'), REQUEST_MS + 1000)).toBe(true)
  })

  it('没目标、不是这个会话、还没就绪时什么都不做', () => {
    expect(beginLocate(null, 's1', true, 1)).toBe(false)
    expect(beginLocate(target, 's2', true, 1)).toBe(false)
    expect(beginLocate(target, 's1', false, 1)).toBe(false)
    expect(expandRequest('s2', 'i1')).toBeNull()
  })
})
