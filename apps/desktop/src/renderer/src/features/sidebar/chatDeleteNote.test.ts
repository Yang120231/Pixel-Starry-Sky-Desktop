import { describe, expect, it } from 'vitest'
import { chatDeleteNote } from './chatDeleteNote'

const chat = { id: 'a', cwd: '/data/chats/a' }
const entry = (name: string) => ({ name, path: name, kind: 'file' as const })

describe('chatDeleteNote', () => {
  it('分叉还用着同一个文件夹：保留，不看里面有什么', () => {
    const fork = { id: 'b', cwd: chat.cwd }
    expect(chatDeleteNote(chat, [chat, fork], { entries: [entry('x')], truncated: false }, '、')).toBe('shared')
    expect(chatDeleteNote(fork, [chat, fork], null, '、')).toBe('shared')
  })

  it('文件夹不在或是空的：没写过文件', () => {
    const others = [chat, { id: 'b', cwd: '/data/chats/b' }]
    expect(chatDeleteNote(chat, others, null, '、')).toBe('empty')
    expect(chatDeleteNote(chat, others, { entries: [], truncated: false }, '、')).toBe('empty')
  })

  it('有文件：数第一层，列前 3 个名字，多的省略', () => {
    const entries = ['src', 'a.md', 'b.txt', 'c.png'].map(entry)
    expect(chatDeleteNote(chat, [chat], { entries: entries.slice(0, 2), truncated: false }, '、')).toEqual({
      count: '2',
      names: 'src、a.md',
    })
    expect(chatDeleteNote(chat, [chat], { entries, truncated: false }, ', ')).toEqual({
      count: '4',
      names: 'src, a.md, b.txt…',
    })
    expect(chatDeleteNote(chat, [chat], { entries, truncated: true }, '、')).toMatchObject({ count: '4+' })
  })
})
