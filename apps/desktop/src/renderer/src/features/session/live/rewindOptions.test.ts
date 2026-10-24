// 回退对话框勾选文件后的选项（docs/ui/undo-changes.md §4）
import { describe, expect, it } from 'vitest'
import { rewindOptions } from './MessageActions'

describe('回退选项', () => {
  it('没挑文件（全部还原）时就是原来的三种选项', () => {
    expect(rewindOptions('both', null)).toEqual({ conversation: true, code: true })
    expect(rewindOptions('conversation', null)).toEqual({ conversation: true, code: false })
  })

  it('只勾了几个文件：带上 paths', () => {
    expect(rewindOptions('code', ['a.ts'])).toEqual({ conversation: false, code: true, paths: ['a.ts'] })
    expect(rewindOptions('both', ['a.ts', 'b.ts'])).toEqual({ conversation: true, code: true, paths: ['a.ts', 'b.ts'] })
  })

  it('全取消勾选：「代码和对话」只回退对话；只回退对话时不带 paths', () => {
    expect(rewindOptions('both', [])).toEqual({ conversation: true, code: false })
    expect(rewindOptions('conversation', ['a.ts'])).toEqual({ conversation: true, code: false })
  })
})
