import { describe, expect, it } from 'vitest'
import { PHONE_DIFF_LIMIT, phoneDiff } from './diff'

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`)

describe('phoneDiff', () => {
  it('keeps three lines around each change and merges changes that are close', () => {
    const a = numbered(30)
    const b = [...a]
    b[4] = 'changed 5'
    b[8] = 'changed 9'
    b.splice(25, 1)
    const r = phoneDiff(a.join('\n') + '\n', b.join('\n') + '\n')
    expect(r).toMatchObject({ added: 2, removed: 3, cut: false })
    expect(r.diff.split('\n')).toEqual([
      '@@ -2,11 +2,11 @@',
      ' line 2',
      ' line 3',
      ' line 4',
      '-line 5',
      '+changed 5',
      ' line 6',
      ' line 7',
      ' line 8',
      '-line 9',
      '+changed 9',
      ' line 10',
      ' line 11',
      ' line 12',
      '@@ -23,7 +23,6 @@',
      ' line 23',
      ' line 24',
      ' line 25',
      '-line 26',
      ' line 27',
      ' line 28',
      ' line 29',
    ])
  })

  it('handles new, deleted and unchanged files and CRLF', () => {
    expect(phoneDiff(null, 'a\nb\n')).toEqual({ diff: '@@ -1,0 +1,2 @@\n+a\n+b', added: 2, removed: 0, cut: false })
    expect(phoneDiff('a\r\nb\r\n', null)).toEqual({ diff: '@@ -1,2 +1,0 @@\n-a\n-b', added: 0, removed: 2, cut: false })
    expect(phoneDiff('a\r\nb\r\n', 'a\nb\n')).toEqual({ diff: '', added: 0, removed: 0, cut: false })
  })

  it('cuts very long diffs but still counts every line', () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `${i} ${'x'.repeat(40)}`)
    const r = phoneDiff(null, big.join('\n'))
    expect(r.cut).toBe(true)
    expect(r.added).toBe(20_000)
    expect(r.diff.length).toBeLessThanOrEqual(PHONE_DIFF_LIMIT)
  })
})
