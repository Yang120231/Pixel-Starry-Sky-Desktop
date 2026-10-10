import { describe, expect, it } from 'vitest'
import { isNoRelease, notesText, updateError } from './update-notes'

describe('notesText', () => {
  it('turns release HTML into plain text', () => {
    expect(notesText('<h2>新功能</h2><ul><li>轮次跳转条</li><li>A &amp; B</li></ul><p>修复 &lt;bug&gt;</p>')).toBe(
      '新功能\n\n• 轮次跳转条\n• A & B\n\n修复 <bug>',
    )
  })
  it('joins multi-version notes and handles empty input', () => {
    expect(
      notesText([
        { version: '2', note: '<p>二</p>' },
        { version: '1', note: '一' },
      ]),
    ).toBe('二\n\n一')
    expect(notesText(null)).toBeUndefined()
    expect(notesText('<p> </p>')).toBeUndefined()
  })
})

describe('update errors', () => {
  it('treats a missing release as up to date', () => {
    expect(isNoRelease('No published versions on GitHub')).toBe(true)
    // 仓库还没有公开 / 没有任何 Release 时，GitHub 的 releases.atom 返回 404
    expect(isNoRelease('404 \nHeaders: {}')).toBe(true)
    expect(isNoRelease('4040 bytes')).toBe(false)
    expect(isNoRelease('net::ERR_INTERNET_DISCONNECTED')).toBe(false)
  })
  it('explains network failures', () => {
    expect(updateError('getaddrinfo ENOTFOUND github.com')).toBe('连不上 GitHub，请检查网络后重试')
    expect(updateError('something odd\nstack…')).toBe('something odd')
  })
})
