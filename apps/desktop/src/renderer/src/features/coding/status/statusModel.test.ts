import { describe, expect, it } from 'vitest'
import { branchText, encodingText, newlineText } from './statusModel'

const base = { repo: true, branch: 'main', detached: false, head: 'abcdef0123', ahead: 0, behind: 0 }

describe('branchText', () => {
  it('ahead 和 behind 为 0 时只写分支名', () => expect(branchText(base)).toBe('main'))
  it('写 ahead 和 behind', () => expect(branchText({ ...base, ahead: 2, behind: 1 })).toBe('main ↑2 ↓1'))
  it('只有一边时只写那一边', () => {
    expect(branchText({ ...base, ahead: 3 })).toBe('main ↑3')
    expect(branchText({ ...base, behind: 4 })).toBe('main ↓4')
  })
  it('游离 HEAD 写短 hash', () => expect(branchText({ ...base, branch: null, detached: true })).toBe('abcdef0'))
  it('不是仓库返回 null', () => expect(branchText({ ...base, repo: false })).toBeNull())
})

describe('encodingText / newlineText', () => {
  it('编码', () => {
    expect(encodingText(false)).toBe('UTF-8')
    expect(encodingText(true)).toBe('UTF-8 BOM')
  })
  it('换行大写', () => {
    expect(newlineText('lf')).toBe('LF')
    expect(newlineText('crlf')).toBe('CRLF')
  })
})
