import { describe, expect, it } from 'vitest'
import { highlightSegments, shellLanguage } from './highlight'

describe('shellLanguage', () => {
  it('明显是 PowerShell 的按 PowerShell，其余按 bash', () => {
    expect(shellLanguage('powershell -NoProfile -Command "ls"')).toBe('powershell')
    expect(shellLanguage('& pwsh.exe -c dir')).toBe('powershell')
    expect(shellLanguage('Get-ChildItem -Recurse | Select-Object Name')).toBe('powershell')
    expect(shellLanguage('echo $env:PATH')).toBe('powershell')
    expect(shellLanguage('git status && npm test')).toBe('bash')
    expect(shellLanguage('ls -la "$HOME"')).toBe('bash')
  })
})

describe('highlightSegments', () => {
  it('按行切开，跨行的注释每行都带着类名', () => {
    const lines = highlightSegments('/* a\nb */\nx', 'javascript')
    expect(lines).toHaveLength(3)
    expect(lines[0][0].className).toContain('hljs-comment')
    expect(lines[1][0].className).toContain('hljs-comment')
  })

  it('不认识的语言每行一段纯文字，空行是空数组', () => {
    expect(highlightSegments('a\n\nb', null)).toEqual([
      [{ text: 'a', className: null }],
      [],
      [{ text: 'b', className: null }],
    ])
  })
})
