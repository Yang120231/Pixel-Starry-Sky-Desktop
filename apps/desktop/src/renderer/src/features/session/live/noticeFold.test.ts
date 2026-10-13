import { describe, expect, it } from 'vitest'
import { NOTICE_PREVIEW_LINES, foldNotice } from './noticeFold'

describe('foldNotice', () => {
  it('不超过 3 行不折', () => {
    expect(NOTICE_PREVIEW_LINES).toBe(3)
    expect(foldNotice('子智能体已完成')).toBeNull()
    expect(foldNotice('a\nb\nc')).toBeNull()
    // 末尾的空行不算
    expect(foldNotice('a\nb\nc\n\n  \n')).toBeNull()
  })
  it('超过 3 行：前 3 行和其余的行', () => {
    expect(foldNotice('子智能体已完成：好了\n\n**1. a.ts**\n```ts\nx\n```')).toEqual({
      preview: '子智能体已完成：好了\n\n**1. a.ts**',
      rest: '```ts\nx\n```',
    })
  })
  it('第 3 行是空行时预览不以空行结尾', () => {
    expect(foldNotice('a\nb\n\nc')).toEqual({ preview: 'a\nb', rest: 'c' })
  })
  it('第一行换了语言，其余的行不变', () => {
    const summary = '\n**1.**\n```\nx\n```'
    expect(foldNotice(`Subagent completed: ok${summary}`)?.rest).toBe(
      foldNotice(`子智能体已完成：好了${summary}`)?.rest,
    )
  })
})
