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

  it('从编辑器引用的代码：单独一行的「路径#L12-18」是带行号的文件标签', () => {
    expect(userTextParts('src/Main.java#L12-18\n这里为什么会空指针？')).toEqual([
      { kind: 'mention', text: 'src/Main.java#L12-18', path: 'src/Main.java', lines: { start: 12, end: 18 } },
      { kind: 'text', text: '\n这里为什么会空指针？' },
    ])
    expect(userTextParts('看 src/a.ts#L3 这行')).toEqual([{ kind: 'text', text: '看 src/a.ts#L3 这行' }])
  })

  it('@路径#L12-18 也带行号', () => {
    expect(userTextParts('解释 @src/a.ts#L3-5。')).toEqual([
      { kind: 'text', text: '解释 ' },
      { kind: 'mention', text: '@src/a.ts#L3-5', path: 'src/a.ts', lines: { start: 3, end: 5 } },
      { kind: 'text', text: '。' },
    ])
  })

  it('多行消息里的 @文件 照常拆出来', () => {
    expect(userTextParts('第一行\n改 @a.ts')).toEqual([
      { kind: 'text', text: '第一行\n改 ' },
      { kind: 'mention', text: '@a.ts', path: 'a.ts' },
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
