import { describe, expect, it } from 'vitest'
import type { TurnFile } from '../ai/turnChangesModel'
import { sortTurnFiles } from '../left/files/filesModel'
import { emptyTurnList } from './emptyModel'

const file = (path: string, kind: TurnFile['kind'] = 'update'): TurnFile => ({
  path,
  name: path.split('/').pop() ?? path,
  dir: '',
  kind,
  added: 1,
  removed: 0,
  diffs: [],
})

describe('emptyTurnList', () => {
  it('空和 undefined 都没有第一个', () => {
    expect(emptyTurnList(undefined)).toEqual({ shown: [], more: 0, first: null })
    expect(emptyTurnList([])).toEqual({ shown: [], more: 0, first: null })
  })

  it('排序同左栏：新增在前，其余按路径', () => {
    const files = [file('b.ts'), file('z.ts', 'add'), file('a.ts')]
    const out = emptyTurnList(files)
    expect(out.shown).toEqual(sortTurnFiles(files))
    expect(out.first?.path).toBe('z.ts')
  })

  it('超过 limit 时多出的算在 more 里', () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`f${i}.ts`))
    const out = emptyTurnList(files, 8)
    expect(out.shown).toHaveLength(8)
    expect(out.more).toBe(2)
    expect(emptyTurnList(files.slice(0, 8), 8).more).toBe(0)
  })

  it('不改传入的数组', () => {
    const files = [file('b.ts'), file('a.ts')]
    emptyTurnList(files)
    expect(files.map(f => f.path)).toEqual(['b.ts', 'a.ts'])
  })
})
