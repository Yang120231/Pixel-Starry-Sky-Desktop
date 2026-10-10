// 输入框里的 @ 引用文件（docs/ui/workbench-ux-3.md §2.6）
import { describe, expect, it } from 'vitest'
import type { FileEntry } from '../../../../shared/types/workspace'
import { applyMention, insertMention, mentionAt, rankEntries, splitQuery } from './mention'

const file = (path: string, kind: FileEntry['kind'] = 'file'): FileEntry => ({
  name: path.split('/').pop()!,
  path,
  kind,
})

describe('@ 引用文件', () => {
  it('光标前的 @ 词：开头、空白后算；邮箱、中间有空白、光标不在词尾不算', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionAt('看看 @src/ap', 10)).toEqual({ start: 3, query: 'src/ap' })
    expect(mentionAt('看看\n@app', 7)).toEqual({ start: 3, query: 'app' })
    expect(mentionAt('mail a@b.com', 12)).toBeNull()
    expect(mentionAt('@src app', 8)).toBeNull()
    expect(mentionAt('@src 后面', 3)).toEqual({ start: 0, query: 'sr' })
  })

  it('选文件换成 @路径 加空格，选目录补 / 接着选，路径有空格加引号', () => {
    const text = '看看 @ap 的登录'
    const m = mentionAt(text, 6)!
    expect(applyMention(text, m, 6, file('src/app.ts'))).toEqual({ text: '看看 @src/app.ts 的登录', caret: 15 })
    expect(applyMention('@sr', mentionAt('@sr', 3)!, 3, file('src', 'directory'))).toEqual({ text: '@src/', caret: 5 })
    expect(applyMention('@my', mentionAt('@my', 3)!, 3, file('docs/my notes.md')).text).toBe('@"docs/my notes.md" ')
  })

  it('菜单插入 @：前面不是空白时补空格', () => {
    expect(insertMention('', 0, 0)).toEqual({ text: '@', caret: 1 })
    expect(insertMention('看看', 2, 2)).toEqual({ text: '看看 @', caret: 4 })
    expect(insertMention('看看 ', 3, 3)).toEqual({ text: '看看 @', caret: 4 })
    expect(insertMention('ab', 1, 2)).toEqual({ text: 'a @', caret: 3 })
  })

  it('查询拆成目录和名字', () => {
    expect(splitQuery('')).toEqual({ dir: '', name: '' })
    expect(splitQuery('app')).toEqual({ dir: '', name: 'app' })
    expect(splitQuery('src/')).toEqual({ dir: 'src', name: '' })
    expect(splitQuery('src/feat/ap')).toEqual({ dir: 'src/feat', name: 'ap' })
  })

  it('按名字找到的：只留目录下的，名字开头对上的在前，再按路径短的在前', () => {
    const found = [file('test/app.test.ts'), file('src/mapper.ts'), file('src/app.ts'), file('src/deep/app.ts')]
    expect(rankEntries(found, '', 'app').map(e => e.path)).toEqual([
      'src/app.ts',
      'src/deep/app.ts',
      'test/app.test.ts',
      'src/mapper.ts',
    ])
    expect(rankEntries(found, 'SRC', 'app').map(e => e.path)).toEqual([
      'src/app.ts',
      'src/deep/app.ts',
      'src/mapper.ts',
    ])
  })
})
