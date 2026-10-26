import { describe, expect, it } from 'vitest'
import type { ExtPackInfo, ExtPackState } from '@pixelsky/protocol'
import { officialPackFor, shouldRecommend } from './recommend'

const state = (ids: string[], loading = false): ExtPackState => ({
  revision: 1,
  loading,
  packs: ids.map(id => ({ id }) as ExtPackInfo),
})

describe('按文件类型推荐官方语言扩展', () => {
  it('按扩展名找扩展，不分大小写；没有扩展名、点开头的文件不认', () => {
    expect(officialPackFor('D:\\proj\\src\\main.PY')).toBe('pixelsky.python')
    expect(officialPackFor('/a/b/App.vue')).toBe('pixelsky.vue')
    expect(officialPackFor('/a/include/x.h')).toBe('pixelsky.cpp')
    expect(officialPackFor('/a/Makefile')).toBeNull()
    expect(officialPackFor('/a/.lua')).toBeNull()
    expect(officialPackFor('/a/readme.md')).toBeNull()
  })
  it('装过（含停用）、推荐过、扩展列表还没读完时不推荐', () => {
    expect(shouldRecommend('pixelsky.go', state([]), new Set())).toBe(true)
    expect(shouldRecommend('pixelsky.go', state(['pixelsky.go']), new Set())).toBe(false)
    expect(shouldRecommend('pixelsky.go', state([]), new Set(['pixelsky.go']))).toBe(false)
    expect(shouldRecommend('pixelsky.go', state([], true), new Set())).toBe(false)
  })
})
