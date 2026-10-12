import { describe, expect, it } from 'vitest'
import { displayMemoryPath, splitFileName } from './memoryPath'

const win = { home: String.raw`C:\Users\linxia`, root: String.raw`D:\pixel-web`, windows: true }
const posix = { home: '/Users/linxia', root: '/Users/linxia/code/pixel-web', windows: false }

describe('记忆文件路径的显示', () => {
  it('项目里的写成相对路径，用户目录下的写成 ~ 开头，其余原样', () => {
    expect(displayMemoryPath(String.raw`D:\pixel-web\CLAUDE.md`, win)).toBe('CLAUDE.md')
    expect(displayMemoryPath(String.raw`C:\Users\linxia\.claude\CLAUDE.md`, win)).toBe(String.raw`~\.claude\CLAUDE.md`)
    expect(displayMemoryPath(String.raw`E:\shared\CLAUDE.md`, win)).toBe(String.raw`E:\shared\CLAUDE.md`)
    // 项目在用户目录里面：先按项目算
    expect(displayMemoryPath('/Users/linxia/code/pixel-web/docs/AGENTS.md', posix)).toBe('docs/AGENTS.md')
    expect(displayMemoryPath('/Users/linxia/.claude/CLAUDE.md', posix)).toBe('~/.claude/CLAUDE.md')
  })

  it('Windows 不区分大小写、两种分隔符都认；目录名只是前缀相同的不算在里面', () => {
    expect(displayMemoryPath('c:/users/LINXIA/.claude/CLAUDE.md', win)).toBe('~/.claude/CLAUDE.md')
    expect(displayMemoryPath(String.raw`D:\pixel-web-copies\CLAUDE.md`, win)).toBe(
      String.raw`D:\pixel-web-copies\CLAUDE.md`,
    )
    expect(displayMemoryPath('/Users/LINXIA/.claude/CLAUDE.md', posix)).toBe('/Users/LINXIA/.claude/CLAUDE.md')
    // 根目录带结尾分隔符、不知道根目录 / 用户目录
    expect(
      displayMemoryPath(String.raw`D:\pixel-web\CLAUDE.md`, { ...win, root: String.raw`D:\pixel-web\ `.trim() }),
    ).toBe('CLAUDE.md')
    expect(displayMemoryPath(String.raw`D:\pixel-web\CLAUDE.md`, { home: null, root: null, windows: true })).toBe(
      String.raw`D:\pixel-web\CLAUDE.md`,
    )
  })

  it('分成目录和文件名', () => {
    expect(splitFileName(String.raw`~\.claude\projects\D--pixel-web\memory\MEMORY.md`)).toEqual({
      dir: String.raw`~\.claude\projects\D--pixel-web\memory\ `.trim(),
      name: 'MEMORY.md',
    })
    expect(splitFileName('CLAUDE.md')).toEqual({ dir: '', name: 'CLAUDE.md' })
    expect(splitFileName('docs/AGENTS.md')).toEqual({ dir: 'docs/', name: 'AGENTS.md' })
  })
})
