import { describe, expect, it } from 'vitest'
import { attemptFor, sendKey } from './retry'

let n = 0
const newId = () => `id-${++n}`

describe('重试沿用 clientMessageId', () => {
  it('同样的内容（会话、文字、附件都一样）沿用上次的 ID', () => {
    const first = attemptFor(null, sendKey('s1', '你好', ['img1']), newId)
    expect(attemptFor(first, sendKey('s1', '你好', ['img1']), newId)).toBe(first)
  })
  it('文字、附件、会话变了就换新 ID', () => {
    const first = attemptFor(null, sendKey('s1', '你好', []), newId)
    expect(attemptFor(first, sendKey('s1', '你好啊', []), newId).id).not.toBe(first.id)
    expect(attemptFor(first, sendKey('s1', '你好', ['img2']), newId).id).not.toBe(first.id)
    expect(attemptFor(first, sendKey('s2', '你好', []), newId).id).not.toBe(first.id)
  })
  it('上次已经成功（清掉了）就换新 ID', () => {
    expect(attemptFor(null, sendKey('s1', '你好', []), newId).id).not.toBe(
      attemptFor(null, sendKey('s1', '你好', []), newId).id,
    )
  })
})
