import { describe, expect, it } from 'vitest'
import { fakePack, fakeState } from '../testing'
import { fillPrompt, promptItems } from './model'

const vars = { selection: 'S', file: 'a.ts', language: 'TypeScript', project: 'proj' }

describe('fillPrompt', () => {
  it('替换四个占位符，不认识的不动', () => {
    expect(fillPrompt('{{file}} {{language}} {{project}} {{selection}} {{x}}', vars)).toBe(
      'a.ts TypeScript proj S {{x}}',
    )
  })
  it('选中的内容原样放入，不再扫描', () => {
    expect(fillPrompt('{{selection}} | {{file}}', { ...vars, selection: 'x {{file}} y' })).toBe('x {{file}} y | a.ts')
  })
})

describe('promptItems', () => {
  const state = fakeState(
    fakePack({
      key: 'k1',
      id: 'a.one',
      contributes: {
        prompts: [
          { id: 'p', title: { zh: '解释', en: 'Explain' }, path: 'p.md', requires: 'selection' },
          { id: 'e', title: '仅编辑器', path: 'e.md', where: ['editor'] },
          { id: 'c', title: '仅输入框', path: 'c.md', where: ['composer'] },
        ],
      },
    }),
    fakePack({ key: 'k2', id: 'b.two', contributes: { prompts: [{ id: 'p', title: '同名', path: 'p.md' }] } }),
  )
  it('按 where 过滤，默认两处都有', () => {
    expect(promptItems(state, 'composer', 'zh-CN').map(i => `${i.packId}/${i.id}`)).toEqual([
      'a.one/p',
      'a.one/c',
      'b.two/p',
    ])
    expect(promptItems(state, 'editor', 'zh-CN').map(i => i.id)).toEqual(['p', 'e', 'p'])
  })
  it('标题按语言，requires 转成标记', () => {
    const [first] = promptItems(state, 'composer', 'en-US')
    expect(first.title).toBe('Explain')
    expect(first.requiresSelection).toBe(true)
    expect(promptItems(state, 'composer', 'zh-CN')[0].title).toBe('解释')
  })
  it('停用的提示词不列出', () => {
    const off = fakeState(
      fakePack({ contributes: { prompts: [{ id: 'p', title: 't', path: 'p.md' }] }, inactive: { prompts: [0] } }),
    )
    expect(promptItems(off, 'composer', 'zh-CN')).toEqual([])
  })
})
