import { describe, expect, it } from 'vitest'
import { parentDir, planTreeChange } from './treeChange'

const change = (over: Partial<Parameters<typeof planTreeChange>[0]>) => ({
  added: [],
  changed: [],
  git: false,
  overflow: false,
  ...over,
})

describe('文件树监听变化怎么刷新', () => {
  it('所在文件夹：主文件夹、附加文件夹、根目录自己', () => {
    expect(parentDir('a/b.txt', '')).toBe('a')
    expect(parentDir('b.txt', '')).toBe('')
    expect(parentDir('::1/x', '::1')).toBe('::1')
    expect(parentDir('::1/a/x', '::1')).toBe('::1/a')
    expect(parentDir('::1', '::1')).toBeNull()
    expect(parentDir('', '')).toBeNull()
  })

  it('新增 / 删除重读所在文件夹；被忽略的路径不重读 Git 状态；根目录自己变了或太多就整棵重读', () => {
    const ignored = new Set(['node_modules'])
    expect(planTreeChange(change({ added: ['src/a.ts', 'b.ts', '::1/c'] }), ignored, ['::1'])).toEqual({
      all: false,
      dirs: ['src', '', '::1'],
      status: true,
    })
    expect(planTreeChange(change({ added: ['node_modules/x/y.js'] }), ignored, [])).toEqual({
      all: false,
      dirs: ['node_modules/x'],
      status: false,
    })
    expect(planTreeChange(change({ changed: ['node_modules/x/y.js'] }), ignored, []).status).toBe(false)
    expect(planTreeChange(change({ changed: ['src/a.ts'] }), ignored, [])).toEqual({
      all: false,
      dirs: [],
      status: true,
    })
    expect(planTreeChange(change({ git: true }), ignored, []).status).toBe(true)
    expect(planTreeChange(change({ added: ['::2'] }), ignored, ['::1', '::2']).all).toBe(true)
    expect(planTreeChange(change({ overflow: true }), ignored, []).all).toBe(true)
  })
})
