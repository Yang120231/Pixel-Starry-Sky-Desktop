import { describe, expect, it } from 'vitest'
import { fileTab } from '../panes/tree'
import { parseRecent, pushRecent, RECENT_LIMIT } from './recentFiles'

describe('right workspace recent files', () => {
  const file = (path: string) => fileTab({ projectId: 'project-a' }, path)
  it('moves a reopened file to the front without duplicates and keeps at most the limit', () => {
    let list = pushRecent([], file('a.ts'), 1)
    list = pushRecent(list, file('b.ts'), 2)
    list = pushRecent(list, file('a.ts'), 3)
    expect(list).toEqual([
      { id: file('a.ts'), at: 3 },
      { id: file('b.ts'), at: 2 },
    ])
    for (let i = 0; i < RECENT_LIMIT + 5; i++) list = pushRecent(list, file(`f${i}.ts`), 10 + i)
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(list[0].id).toBe(file(`f${RECENT_LIMIT + 4}.ts`))
  })
  it('keeps scopes apart and drops broken records', () => {
    const parsed = parseRecent({
      'd:/one': [
        { id: file('a.ts'), at: 1 },
        { id: file('a.ts'), at: 2 },
        { id: 'not-a-file', at: 3 },
        { id: file('b.ts'), at: 'x' },
        null,
      ],
      'd:/two': [{ id: file('c.ts'), at: 4 }],
      'd:/bad': 'nope',
    })
    expect(parsed).toEqual({ 'd:/one': [{ id: file('a.ts'), at: 1 }], 'd:/two': [{ id: file('c.ts'), at: 4 }] })
    expect(parseRecent(null)).toEqual({})
    expect(parseRecent([1, 2])).toEqual({})
  })
})
