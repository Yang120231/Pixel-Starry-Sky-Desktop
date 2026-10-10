import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { INTERACT_MS, STICK_PX, afterResize, contentMark, followResize, nearBottom } from './scrollFollow'

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

describe('afterResize', () => {
  // 离底部 150px：已离开底部
  const away = { scrollHeight: 1150, scrollTop: 500, clientHeight: 500 }
  // 下面的卡片收起，对话区高了 100px、滚动位置没变：离底部 50px，已经算到底
  const grown = { scrollHeight: 1150, scrollTop: 500, clientHeight: 600 }

  it('贴底且最近没有操作：跟到底', () => {
    expect(afterResize(away, true, false, 0, INTERACT_MS)).toEqual({ follow: true })
  })
  it('没贴底时底部自己靠过来：按钮消失并恢复贴底', () => {
    expect(afterResize(grown, false, false, 0, 10_000)).toEqual({ follow: false, stick: true, away: false })
  })
  it('没贴底、仍离开底部：保持', () => {
    expect(afterResize(away, false, false, 0, 10_000)).toEqual({ follow: false, stick: false, away: true })
  })
  it('刚操作过（展开了内容）把底部顶远：不跟、离开底部', () => {
    expect(afterResize(away, true, false, 1000, 1000 + INTERACT_MS - 1)).toEqual({
      follow: false,
      stick: false,
      away: true,
    })
  })
  it('搜索跳转后：只更新按钮，不恢复贴底', () => {
    expect(afterResize(grown, false, true, 0, 10_000)).toEqual({ follow: false, stick: false, away: false })
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
