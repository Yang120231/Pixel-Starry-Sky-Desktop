import { describe, expect, it } from 'vitest'
import { searchLiteral, type Item } from '@pixelsky/protocol'
import { foldedMatches, foldedText } from './foldedText'

const command: Item = {
  kind: 'command',
  id: 'c1',
  command: 'npm test',
  description: null,
  output: '\u001b[32mok\u001b[39m 银河\nfail 银河',
  exitCode: 0,
  status: 'completed',
}
const tool: Item = {
  kind: 'tool',
  id: 't1',
  tool: 'read',
  name: 'Read',
  title: 'a.ts',
  output: 'line 银河',
  status: 'completed',
}
const change: Item = {
  kind: 'file_change',
  id: 'f1',
  changes: [
    { path: 'a.ts', kind: 'update', diff: '-old\n+new 银河', added: 1, removed: 1 },
    { path: 'b.ts', kind: 'update', diff: '+b', added: 1, removed: 0 },
  ],
  status: 'completed',
}
const reasoning: Item = { kind: 'reasoning', id: 'r1', text: '想想银河', status: 'completed' }
const todo: Item = {
  kind: 'todo',
  id: 'd1',
  steps: [
    { text: '写银河', status: 'completed' },
    { text: '测银河', status: 'in_progress' },
    { text: '发布', status: 'pending' },
  ],
  status: 'completed',
}
const notice: Item = { kind: 'notice', id: 'n1', level: 'error', text: '失败', detail: '  详情 银河  ' }

describe('foldedText', () => {
  it('命令输出去掉 ANSI', () => {
    expect(foldedText(command)).toBe('ok 银河\nfail 银河')
  })
  it('工具输出、文件 diff、思考、提示详情', () => {
    expect(foldedText(tool)).toBe('line 银河')
    expect(foldedText(change)).toBe('-old\n+new 银河\n+b')
    expect(foldedText(reasoning)).toBe('想想银河')
    expect(foldedText(notice)).toBe('详情 银河')
  })
  it('待办不含进行中那一步（折叠时也显示在概要里）', () => {
    expect(foldedText(todo)).toBe('写银河\n发布')
  })
  it('正文和用户消息没有折叠部分', () => {
    expect(foldedText({ kind: 'assistant', id: 'a', text: '银河', status: 'completed' })).toBe('')
    expect(foldedText({ kind: 'notice', id: 'n2', level: 'info', text: '银河' })).toBe('')
  })
})

describe('foldedMatches', () => {
  const items = [command, tool, change, reasoning, todo, notice]
  const term = [searchLiteral('银河')]
  it('只数折叠着的条目', () => {
    expect(foldedMatches(items, term, new Set(['c1', 'r1']))).toEqual({ ids: ['c1', 'r1'], count: 3 })
  })
  it('全部折叠', () => {
    const all = new Set(items.map(i => i.id))
    expect(foldedMatches(items, term, all)).toEqual({ ids: ['c1', 't1', 'f1', 'r1', 'd1', 'n1'], count: 7 })
  })
  it('不分大小写，和 Ctrl+F 一致', () => {
    expect(foldedMatches([tool], [searchLiteral('LINE')], new Set(['t1'])).count).toBe(1)
  })
  it('没有搜索词或没有折叠的条目', () => {
    expect(foldedMatches(items, [], new Set(['c1']))).toEqual({ ids: [], count: 0 })
    expect(foldedMatches(items, term, new Set())).toEqual({ ids: [], count: 0 })
  })
})
