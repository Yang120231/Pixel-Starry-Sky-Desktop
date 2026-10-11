// 更新内容：列哪几版的说明（GitHub #13）
import { describe, expect, it } from 'vitest'
import { RELEASE_NOTES, countKinds, notesFor, olderNotes, parseNotes } from './whatsNew'

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

  it('更早的版本：比这次列出的都旧，新的在前', () => {
    const older = (version: string, previous: string | null) =>
      olderNotes({ version, previous }, notes).map(n => n.version)
    expect(older('0.2.2-beta', '0.2.0-beta')).toEqual(['0.2.0-beta'])
    expect(older('0.2.2', null)).toEqual(['0.2.2-beta', '0.2.1-beta', '0.2.0-beta'])
  })
})

describe('说明的结构', () => {
  const text = [
    '## 新功能',
    '',
    '- **顶栏「打开方式」**：一键打开。（GitHub #12）',
    '- **图表**：折线。',
    '  - 点图例可以隐藏。',
    '  - 键盘 ← / →。',
    '',
    '## 修复',
    '',
    '- 回复被收进「执行」块。(GitHub #3、#4)',
    '- **只有标题**',
  ].join('\n')

  it('按 ## 分组，认出新功能 / 修复；加粗开头是标题，子列表留在正文里，GitHub 编号单独拿出来', () => {
    const sections = parseNotes(text)
    expect(sections.map(s => [s.kind, s.items.length])).toEqual([
      ['feature', 2],
      ['fix', 2],
    ])
    expect(sections[0].items[0]).toEqual({ title: '顶栏「打开方式」', body: '一键打开。', issues: [12] })
    expect(sections[0].items[1]).toEqual({
      title: '图表',
      body: '折线。\n- 点图例可以隐藏。\n- 键盘 ← / →。',
      issues: [],
    })
    expect(sections[1].items[0]).toEqual({ body: '回复被收进「执行」块。', issues: [3, 4] })
    expect(sections[1].items[1]).toEqual({ title: '只有标题', body: '', issues: [] })
    expect(countKinds(sections)).toEqual({ feature: 2, fix: 2 })
  })

  it('没有分组标题、不是列表的段落各算一条；仓库里每一版都拆得出条目', () => {
    expect(parseNotes('第一段\n\n第二段')).toEqual([
      {
        kind: 'other',
        heading: '',
        items: [
          { body: '第一段', issues: [] },
          { body: '第二段', issues: [] },
        ],
      },
    ])
    for (const [version, body] of Object.entries(RELEASE_NOTES)) {
      const sections = parseNotes(body)
      expect(sections.length, version).toBeGreaterThan(0)
      expect(
        sections.every(s => s.kind !== 'other'),
        version,
      ).toBe(true)
    }
  })
})
