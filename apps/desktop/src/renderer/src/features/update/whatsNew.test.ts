// 更新内容：列哪几版的说明（GitHub #13）
import { describe, expect, it } from 'vitest'
import { RELEASE_NOTES, notesFor } from './whatsNew'

const notes = { '0.2.0-beta': 'a', '0.2.1-beta': 'b', '0.2.2-beta': 'c', '0.2.2': 'd', '0.3.0-beta': 'e' }

describe('更新内容', () => {
  it('打包了仓库里写的各版说明', () => {
    expect(RELEASE_NOTES['0.2.0-beta']).toMatch(/^## 新功能/)
  })

  it('跳过了几版：列出中间每一版，新的在前，不含上次那版和以后的', () => {
    expect(notesFor({ version: '0.2.2-beta', previous: '0.2.0-beta' }, notes).map(n => n.version)).toEqual([
      '0.2.2-beta',
      '0.2.1-beta',
    ])
    expect(notesFor({ version: '0.2.2', previous: '0.2.1-beta' }, notes).map(n => n.version)).toEqual([
      '0.2.2',
      '0.2.2-beta',
    ])
  })

  it('不知道上次的版本：只列当前这版；这版没写说明就没有', () => {
    expect(notesFor({ version: '0.2.1-beta', previous: null }, notes)).toEqual([{ version: '0.2.1-beta', text: 'b' }])
    expect(notesFor({ version: '9.9.9', previous: null }, notes)).toEqual([])
  })
})
