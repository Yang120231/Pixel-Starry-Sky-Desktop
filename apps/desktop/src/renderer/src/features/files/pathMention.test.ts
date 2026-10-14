import { describe, expect, it } from 'vitest'
import { pathMention } from './pathMention'
import { quotePath } from '@/features/session/quote'

describe('发送路径到对话', () => {
  it('文件写成 @相对路径，文件夹末尾带 /，有空白加引号，都以空格结尾', () => {
    expect(pathMention('src/session/SessionHeader.tsx', false)).toBe('@src/session/SessionHeader.tsx ')
    expect(pathMention('src/session', true)).toBe('@src/session/ ')
    expect(pathMention('docs\\my notes.md', false)).toBe('@"docs/my notes.md" ')
  })
  it('会话的工作目录就是这个项目时用相对路径，不是时用完整路径', () => {
    expect(quotePath({ root: 'D:/web', path: 'src/a.ts' }, 'D:\\web')).toBe('src/a.ts')
    expect(quotePath({ root: 'D:/web', path: 'src/a.ts' }, 'D:/other')).toBe('D:/web/src/a.ts')
    expect(quotePath({ root: 'D:/web', path: 'src/a.ts' }, null)).toBe('src/a.ts')
  })
})
