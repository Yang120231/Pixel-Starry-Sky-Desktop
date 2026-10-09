import { describe, expect, it } from 'vitest'
import { demoFileHits, mergeFileHits } from './fileSearch'

const ref = { projectId: 'p' }

describe('global search › project files', () => {
  it('lists name hits first, then line hits, and caps the brief mode', () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ path: 'src/a.ts', line: i + 1, column: 1, text: 'x' }))
    const brief = mergeFileHits(ref, ['a.ts', 'b.ts', 'c.ts', 'd.ts'], lines, 'brief', false)
    expect(brief.hits.map(h => (h.line === null ? h.path : `${h.path}:${h.line}`))).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
      'src/a.ts:1',
      'src/a.ts:2',
      'src/a.ts:3',
      'src/a.ts:4',
      'src/a.ts:5',
    ])
    expect(brief.truncated).toBe(true)
    const full = mergeFileHits(ref, ['a.ts'], lines, 'full', false)
    expect(full.hits).toHaveLength(9)
    expect(full.truncated).toBe(false)
  })
  it('demo mode searches file names and lines case-insensitively', () => {
    const result = demoFileHits(
      ref,
      { 'src/App.tsx': 'const app = 1\nexport default App', 'README.md': 'hi' },
      'app',
      'full',
    )
    expect(result.hits.map(h => h.key)).toEqual(['name:src/App.tsx', 'line:src/App.tsx:1:7', 'line:src/App.tsx:2:16'])
  })
})
