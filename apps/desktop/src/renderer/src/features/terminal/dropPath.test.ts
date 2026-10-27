import { describe, expect, it } from 'vitest'
import { quotePath } from './dropPath'

describe('quotePath', () => {
  it('没有空格和特殊字符：原样', () => {
    expect(quotePath('C:\\work\\app.ts', 'pwsh', true)).toBe('C:\\work\\app.ts')
    expect(quotePath('/home/me/a-b_c.txt', 'bash', false)).toBe('/home/me/a-b_c.txt')
    expect(quotePath('src/app.ts', 'cmd', true)).toBe('src/app.ts')
  })

  it('PowerShell：单引号，里面的单引号写两个', () => {
    expect(quotePath("C:\\My Docs\\it's.txt", 'pwsh', true)).toBe("'C:\\My Docs\\it''s.txt'")
    expect(quotePath('C:\\My Docs\\a.txt', 'powershell', true)).toBe("'C:\\My Docs\\a.txt'")
  })

  it('PowerShell：弯引号也写两个，文件名结束不了引号', () => {
    expect(quotePath('C:\\x\\John’s notes.txt', 'pwsh', true)).toBe("'C:\\x\\John’’s notes.txt'")
    expect(quotePath('C:\\x\\a’; calc; ‘.txt', 'pwsh', true)).toBe("'C:\\x\\a’’; calc; ‘‘.txt'")
  })

  it('cmd：双引号；逗号、等号在 cmd 里是分隔符，也加', () => {
    expect(quotePath('C:\\My Docs\\a.txt', 'cmd', true)).toBe('"C:\\My Docs\\a.txt"')
    expect(quotePath('C:\\a,b=c.txt', 'cmd', true)).toBe('"C:\\a,b=c.txt"')
  })

  it('Git Bash：反斜杠换成 /，再按 bash 加单引号', () => {
    expect(quotePath('C:\\work\\app.ts', 'git-bash', true)).toBe('C:/work/app.ts')
    expect(quotePath("C:\\My Docs\\it's.txt", 'git-bash', true)).toBe("'C:/My Docs/it'\\''s.txt'")
  })

  it('bash / zsh：单引号；中文、括号也加', () => {
    expect(quotePath('/Users/me/My Docs/a.txt', 'zsh', false)).toBe("'/Users/me/My Docs/a.txt'")
    expect(quotePath('/home/me/报告(1).txt', 'bash', false)).toBe("'/home/me/报告(1).txt'")
    // 文件名里的 \ 不加引号会被当成转义
    expect(quotePath('/home/me/a\\b', 'bash', false)).toBe("'/home/me/a\\b'")
    expect(quotePath('/home/me/a\\b', 'custom-1', false)).toBe("'/home/me/a\\b'")
  })

  it('自定义 Shell：Windows 上双引号，其他系统单引号', () => {
    expect(quotePath('C:\\My Docs\\a.txt', 'custom-1', true)).toBe('"C:\\My Docs\\a.txt"')
    expect(quotePath('/home/me/My Docs', 'custom-1', false)).toBe("'/home/me/My Docs'")
  })
})
