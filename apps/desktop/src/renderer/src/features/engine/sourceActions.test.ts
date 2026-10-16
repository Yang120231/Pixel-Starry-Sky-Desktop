import { describe, expect, it } from 'vitest'
import { PENDING_SOURCE_ACTION_MS, requestSourceActionAfterOpen, takePendingSourceAction } from './sourceActions'

describe('等输入框挂上再执行的操作', () => {
  it('记下后能取走一次，取走就清掉', () => {
    requestSourceActionAfterOpen('s1', 'retry', 1000)
    expect(takePendingSourceAction('s1', 1500)).toBe('retry')
    expect(takePendingSourceAction('s1', 1500)).toBeNull()
  })

  it('按会话分开记，后记的覆盖先记的', () => {
    requestSourceActionAfterOpen('a', 'retry', 0)
    requestSourceActionAfterOpen('b', 'open-menu', 0)
    requestSourceActionAfterOpen('a', 'use-self', 0)
    expect(takePendingSourceAction('b', 1)).toBe('open-menu')
    expect(takePendingSourceAction('a', 1)).toBe('use-self')
  })

  it('过了期限没人接就作废', () => {
    requestSourceActionAfterOpen('s2', 'use-platform', 0)
    expect(takePendingSourceAction('s2', PENDING_SOURCE_ACTION_MS + 1)).toBeNull()
  })

  it('没记过的会话取到空', () => {
    expect(takePendingSourceAction('never')).toBeNull()
  })
})
