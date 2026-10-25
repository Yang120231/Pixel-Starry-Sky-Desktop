import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import {
  DETAIL_LIMIT,
  buildDoc,
  exportBaseName,
  hasExportable,
  redactDoc,
  renderDoc,
  scanDoc,
  selectDoc,
  summarize,
  turnOf,
} from './model'

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123'
const record = { title: '修复登录页', engine: 'claude', model: 'claude-opus-5-5' } as const
const user = (id: string, text: string, extra: Partial<Extract<Item, { kind: 'user' }>> = {}): Item => ({
  kind: 'user',
  id,
  text,
  createdAt: 1_700_000_000_000,
  ...extra,
})
const reply = (id: string, text: string): Item => ({ kind: 'assistant', id, text, status: 'completed' })
const command = (id: string, cmd: string, output: string, exitCode = 0): Item => ({
  kind: 'command',
  id,
  command: cmd,
  description: null,
  output,
  exitCode,
  status: 'completed',
})

const items: Item[] = [
  user('u1', '第一个问题'),
  { kind: 'reasoning', id: 'r1', text: '想一想', status: 'completed' },
  command('c1', 'pnpm test', `ok\nOPENAI_API_KEY=${KEY}`),
  reply('a1', '好了'),
  user('u1b', '中途引导', { mode: 'guidance' }),
  user('u1c', '继续', { reconnect: 1 }),
  { kind: 'turn_stats', id: 's1', turnId: 't1', outcome: 'completed', usage: {} as never },
  user('u2', `第二个问题 ${KEY}`),
  {
    kind: 'tool',
    id: 't2',
    tool: 'read',
    name: 'Read',
    title: '.env',
    output: 'TOKEN=abcdefghijk',
    status: 'completed',
  },
  {
    kind: 'file_change',
    id: 'f2',
    status: 'completed',
    changes: [{ path: 'src/a.ts', kind: 'update', diff: '+x', added: 3, removed: 1 }],
  },
  reply('a2', '改好了'),
]

const doc = buildDoc(items, record, Date.UTC(2026, 9, 25, 6, 30))
const all = { tools: true, thinking: true, from: 1, to: 9 }

describe('buildDoc', () => {
  it('splits turns at user messages; guidance joins the turn, auto-continue is dropped', () => {
    expect(doc.total).toBe(2)
    expect(doc.turns.map(t => t.parts.map(p => p.kind))).toEqual([
      ['user', 'reasoning', 'tool', 'assistant', 'user'],
      ['user', 'tool', 'tool', 'assistant'],
    ])
    expect(doc.turns[1].anchor).toBe('u2')
    expect(doc.engine).toBe('Claude Code')
  })

  it('finds the turn of an item and whether a session has anything to export', () => {
    expect(turnOf(doc, 'a1')).toBe(1)
    expect(turnOf(doc, 'f2')).toBe(2)
    expect(turnOf(doc, 'nope')).toBeNull()
    expect(hasExportable([])).toBe(false)
    expect(hasExportable([user('x', 'a', { reconnect: 1 })])).toBe(false)
    expect(hasExportable(items)).toBe(true)
  })

  it('cuts long tool output and keeps the file-change summary to one line', () => {
    const long = buildDoc([user('u', 'q'), command('c', 'cat big', 'x'.repeat(DETAIL_LIMIT + 50))], record, 0)
    const tool = long.turns[0].parts[1]
    expect(tool.kind === 'tool' && tool.detail.length).toBeLessThan(DETAIL_LIMIT + 80)
    const edit = doc.turns[1].parts[2]
    expect(edit.kind === 'tool' && edit.summary).toBe('src/a.ts (+3 -1)')
  })
})

describe('selectDoc', () => {
  it('applies the turn range and the tool / thinking switches', () => {
    expect(selectDoc(doc, { ...all, from: 2, to: 2 }).turns.map(t => t.n)).toEqual([2])
    expect(selectDoc(doc, { ...all, from: 5, to: 1 }).turns.map(t => t.n)).toEqual([1, 2])
    const bare = selectDoc(doc, { tools: false, thinking: false, from: 1, to: 2 })
    expect(bare.turns.flatMap(t => t.parts).map(p => p.kind)).toEqual([
      'user',
      'assistant',
      'user',
      'user',
      'assistant',
    ])
  })
})

describe('scanDoc / redactDoc', () => {
  it('reports each hit with its turn and source, only inside the selection', () => {
    const hits = scanDoc(selectDoc(doc, all))
    expect(hits.map(h => [h.turn, h.source, h.kind])).toEqual([
      [1, 'output', 'assignment'],
      [2, 'user', 'sk'],
      [2, 'file', 'assignment'],
    ])
    expect(JSON.stringify(hits)).not.toContain(KEY)
    expect(scanDoc(selectDoc(doc, { ...all, from: 1, to: 1, tools: false }))).toEqual([])
    expect(scanDoc(selectDoc(doc, { ...all, from: 1, to: 1 }))).toHaveLength(1)
  })

  it('does not scan tool output that is left out of the export', () => {
    expect(scanDoc(selectDoc(doc, { ...all, tools: false })).map(h => h.source)).toEqual(['user'])
  })

  it('masks every rendered format, not the original doc', () => {
    const masked = redactDoc(selectDoc(doc, all))
    for (const format of ['md', 'html', 'json'] as const) {
      const text = renderDoc(masked, format, 3)
      expect(text).not.toContain(KEY)
      expect(text).not.toContain('abcdefghijk')
      expect(text).toContain('••••')
    }
    expect(renderDoc(doc, 'md')).toContain(KEY)
    expect(scanDoc(masked)).toEqual([])
  })
})

describe('renderDoc', () => {
  const selected = selectDoc(doc, all)

  it('writes Markdown with turns, a folded tool block and plain tool lines', () => {
    const md = renderDoc(selected, 'md')
    expect(md).toContain('# 修复登录页')
    expect(md).toContain('## 第 2 轮')
    expect(md).toContain('<details><summary>命令 pnpm test</summary>')
    expect(md).toContain('- 编辑 src/a.ts (+3 -1)')
  })

  it('uses a longer fence when the output has backticks', () => {
    const d = buildDoc([user('u', 'q'), command('c', 'echo', 'a ``` b')], record, 0)
    expect(renderDoc(d, 'md')).toContain('\n````\na ``` b\n````\n')
  })

  it('escapes HTML in the web page', () => {
    const d = buildDoc([user('u', '<script>alert(1)</script>')], { ...record, title: 'a & b' }, 0)
    const html = renderDoc(d, 'html')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<title>a &amp; b</title>')
  })

  it('writes JSON that parses back with the structure', () => {
    const json = JSON.parse(renderDoc(selected, 'json', 2))
    expect(json).toMatchObject({ format: 'pixelsky-conversation', totalTurns: 2, redacted: 2 })
    expect(json.turns[0].items[2]).toMatchObject({ role: 'tool', label: '命令', summary: 'pnpm test' })
  })

  it('counts messages and tool calls for the preview', () => {
    expect(summarize(selected)).toEqual({ users: 3, replies: 2, tools: 3 })
  })
})

describe('exportBaseName', () => {
  it('adds the turn range for partial exports and strips characters files cannot have', () => {
    expect(exportBaseName(selectDoc(doc, all))).toBe('修复登录页')
    expect(exportBaseName(selectDoc(doc, { ...all, from: 2, to: 2 }))).toBe('修复登录页（第 2 轮）')
    const d = buildDoc([user('u', 'q')], { ...record, title: 'a/b:c*"d"?' }, 0)
    expect(exportBaseName(d)).toBe('a b c d')
  })
})
