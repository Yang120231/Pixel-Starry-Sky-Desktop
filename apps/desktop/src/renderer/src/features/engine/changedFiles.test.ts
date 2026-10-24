// 改动卡片的数据：按路径合并，并收集这一轮各次 diff（docs/ui/changes-inline-diff.md）
import { describe, expect, it } from 'vitest'
import type { FileChange } from '@pixelsky/protocol'
import { toChangedFiles } from './labels'

const change = (path: string, diff: string, added = 1, removed = 0): FileChange => ({
  path,
  kind: 'update',
  diff,
  added,
  removed,
})

describe('改动卡片数据', () => {
  it('同一文件几次编辑合成一行，diff 按顺序收集，没有 diff 的不收', () => {
    const data = toChangedFiles([
      change('src/a.ts', '@@ -1 +1 @@\n-a\n+b', 1, 1),
      change('src/b.ts', ''),
      change('src/a.ts', '@@ -5 +5,2 @@\n+c', 1, 0),
    ])!
    expect(data.files.map(f => [f.dir + f.name, f.added, f.removed, f.diffs])).toEqual([
      ['src/a.ts', 2, 1, ['@@ -1 +1 @@\n-a\n+b', '@@ -5 +5,2 @@\n+c']],
      ['src/b.ts', 1, 0, undefined],
    ])
  })

  it('这一轮第一次改动是新建的文件标 created（撤回 = 删掉），只加了几行的修改不算', () => {
    const data = toChangedFiles([
      { ...change('new.ts', '+x'), kind: 'add' },
      change('new.ts', '+y'),
      change('grow.ts', '+z', 3, 0),
    ])!
    expect(data.files.map(f => [f.name, f.created ?? false])).toEqual([
      ['new.ts', true],
      ['grow.ts', false],
    ])
  })
})
