import { describe, expect, it } from 'vitest'
import { resetKeysChanged } from './ErrorBoundary'

describe('resetKeysChanged', () => {
  it('相同不变，不同或长度变了才算变', () => {
    expect(resetKeysChanged(['a', 1], ['a', 1])).toBe(false)
    expect(resetKeysChanged(['a', 1], ['a', 2])).toBe(true)
    expect(resetKeysChanged(['a'], ['a', 'b'])).toBe(true)
    expect(resetKeysChanged(undefined, undefined)).toBe(false)
  })
})
