import { describe, expect, it } from 'vitest'
import { findPathMatches, projectPath } from './terminalLinks'

const paths = (text: string) => findPathMatches(text).map(m => [m.raw, m.line, m.column])

describe('terminal file path links', () => {
  it('finds paths with line / column in common formats', () => {
    expect(paths('error in src/a.ts:12:5 here')).toEqual([['src/a.ts', 12, 5]])
    expect(paths('./lib/b.js:3')).toEqual([['./lib/b.js', 3, null]])
    expect(paths('src\\app\\main.tsx(14,7): error TS2345')).toEqual([['src\\app\\main.tsx', 14, 7]])
    expect(paths('see README.md for details')).toEqual([['README.md', null, null]])
    expect(paths('at D:\\proj\\src\\x.ts:1:2')).toEqual([['D:\\proj\\src\\x.ts', 1, 2]])
  })
  it('ignores urls, version numbers and plain words', () => {
    expect(paths('open https://example.com/assets/app.js now')).toEqual([])
    expect(paths('node v22.11.0 and 1.2.3')).toEqual([])
    expect(paths('hello world')).toEqual([])
  })
  it('resolves relative to the terminal cwd and keeps only paths inside the project', () => {
    expect(projectPath('src/a.ts', 'D:\\proj', 'D:\\proj', true)).toBe('src/a.ts')
    expect(projectPath('../b.ts', 'D:/proj/src', 'D:/proj', true)).toBe('b.ts')
    expect(projectPath('D:\\PROJ\\src\\c.ts', 'D:/proj', 'd:/proj', true)).toBe('src/c.ts')
    expect(projectPath('../../outside.ts', 'D:/proj/src', 'D:/proj', true)).toBeNull()
    expect(projectPath('C:/other/x.ts', 'D:/proj', 'D:/proj', true)).toBeNull()
    expect(projectPath('/home/u/proj/a.ts', '/tmp', '/home/u/proj', false)).toBe('a.ts')
    expect(projectPath('/home/u/PROJ/a.ts', '/tmp', '/home/u/proj', false)).toBeNull()
    expect(projectPath('D:/project-two/a.ts', 'D:/proj', 'D:/proj', true)).toBeNull()
  })
})
