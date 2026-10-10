import { describe, expect, it } from 'vitest'
import { userTextParts } from './UserText'

describe('userTextParts', () => {
  it('开头的 /命令、$技能 单独标出', () => {
    expect(userTextParts('/compact 保留最近的改动')).toEqual([
      { kind: 'command', text: '/compact' },
      { kind: 'text', text: ' 保留最近的改动' },
    ])
    expect(userTextParts('$review-pr')).toEqual([{ kind: 'command', text: '$review-pr' }])
  })

  it('不在开头的、路径样子的斜杠不算命令', () => {
    expect(userTextParts('看一下 /compact')).toEqual([{ kind: 'text', text: '看一下 /compact' }])
    expect(userTextParts('/usr/bin 里有什么')[0].kind).toBe('text')
  })

  it('@路径 拆出来，句末标点不算进路径，可以带行号', () => {
    expect(userTextParts('改 @src/a.ts:12，再看 @README.md。')).toEqual([
      { kind: 'text', text: '改 ' },
      { kind: 'mention', text: '@src/a.ts:12', path: 'src/a.ts:12' },
      { kind: 'text', text: '，再看 ' },
      { kind: 'mention', text: '@README.md', path: 'README.md' },
      { kind: 'text', text: '。' },
    ])
  })

  it('邮箱、单独的 @ 不算', () => {
    expect(userTextParts('发到 me@example.com 或者 @ 一下')).toEqual([
      { kind: 'text', text: '发到 me@example.com 或者 @ 一下' },
    ])
  })

  it('命令后面跟着 @文件', () => {
    expect(userTextParts('/review @a.ts')).toEqual([
      { kind: 'command', text: '/review' },
      { kind: 'text', text: ' ' },
      { kind: 'mention', text: '@a.ts', path: 'a.ts' },
    ])
  })
})
