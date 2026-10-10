import { describe, expect, it } from 'vitest'
import { diffLineNumbers } from './diffComments'

describe('diff 行号', () => {
  it('按 @@ 段头算：增加和上下文行用新行号，删除行用旧行号', () => {
    const lines = ['@@ -10,3 +20,4 @@', ' a', '-b', '+B', '+C', ' d', '@@ -40 +50 @@', '-x']
    expect(diffLineNumbers(lines)).toEqual([
      null,
      { side: 'new', n: 20 },
      { side: 'old', n: 11 },
      { side: 'new', n: 21 },
      { side: 'new', n: 22 },
      { side: 'new', n: 23 },
      null,
      { side: 'old', n: 40 },
    ])
  })

  it('没有段头的整文件 diff 从 1 开始，文件头不算', () => {
    expect(diffLineNumbers(['--- a', '+++ b', '+one', '+two'])).toEqual([
      null,
      null,
      { side: 'new', n: 1 },
      { side: 'new', n: 2 },
    ])
  })
})
