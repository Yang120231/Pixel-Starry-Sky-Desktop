import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { INTERACT_MS, STICK_PX, contentMark, followResize, nearBottom } from './scrollFollow'

describe('nearBottom', () => {
  it('离底部不到 STICK_PX 算在底部', () => {
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500 })).toBe(true)
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 500 - STICK_PX + 1, clientHeight: 500 })).toBe(true)
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 500 - STICK_PX, clientHeight: 500 })).toBe(false)
  })
  it('内容不满一屏时始终在底部', () => {
    expect(nearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 500 })).toBe(true)
  })
})

describe('followResize', () => {
  it('贴底且最近没有操作才跟', () => {
    expect(followResize(true, 0, INTERACT_MS)).toBe(true)
    expect(followResize(true, 1000, 1000 + INTERACT_MS - 1)).toBe(false)
    expect(followResize(false, 0, 10_000)).toBe(false)
  })
})

describe('contentMark', () => {
  const user: Item = { kind: 'user', id: 'u1', text: 'hi', createdAt: 0 }
  const reply = (text: string): Item => ({ kind: 'assistant', id: 'a1', text, status: 'running' })

  it('条目增加时变化', () => {
    expect(contentMark([user])).not.toBe(contentMark([user, reply('')]))
  })
  it('最后一条文字变长时变化', () => {
    expect(contentMark([user, reply('a')])).not.toBe(contentMark([user, reply('ab')]))
  })
  it('命令输出变长时变化', () => {
    const cmd = (output: string): Item => ({
      kind: 'command',
      id: 'c1',
      command: 'ls',
      description: null,
      output,
      exitCode: null,
      status: 'running',
    })
    expect(contentMark([cmd('a')])).not.toBe(contentMark([cmd('a\nb')]))
  })
  it('只改状态不算新内容', () => {
    expect(contentMark([user, reply('done')])).toBe(
      contentMark([user, { kind: 'assistant', id: 'a1', text: 'done', status: 'completed' }]),
    )
  })
  it('空会话', () => {
    expect(contentMark([])).toBe('0::0')
  })
})
