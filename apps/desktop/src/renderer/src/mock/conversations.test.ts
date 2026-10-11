// 演示里的 Claude 对话展示（docs/ui/demo-conversation.md）：数据前后一致，需要展示的情况都有
import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { demo } from './demo'
import { DEMO_FILES } from './files'
import {
  SHOWCASE_PROJECT,
  SHOWCASE_SESSIONS,
  showcaseSnapshots,
  showcaseSubagentTranscript,
  showcaseTaskOutput,
} from './conversations'

const snapshots = Object.values(showcaseSnapshots)
const items = snapshots.flatMap(s => s.items)
const kinds = <K extends Item['kind']>(kind: K): Extract<Item, { kind: K }>[] =>
  items.filter((i): i is Extract<Item, { kind: K }> => i.kind === kind)

describe('对话展示演示数据', () => {
  it('每个会话都在侧栏的演示项目里，引擎都是 Claude', () => {
    const project = demo.projects.find(p => p.id === SHOWCASE_PROJECT)!
    expect(project.sessions.map(s => s.id)).toEqual(SHOWCASE_SESSIONS.map(s => s.id))
    expect(Object.keys(showcaseSnapshots)).toEqual(SHOWCASE_SESSIONS.map(s => s.id))
    for (const s of snapshots) {
      expect(s.record.engine, s.record.id).toBe('claude')
      expect(s.record.projectId).toBe(SHOWCASE_PROJECT)
    }
  })

  it('条目 id 不重复（含子智能体记录），审批和子智能体指向的条目都在', () => {
    const transcripts = snapshots.flatMap(s => s.runs.agents.map(a => showcaseSubagentTranscript(s.record.id, a.id)))
    const all = [...items, ...transcripts.flat()].map(i => i.id)
    expect(new Set(all).size).toBe(all.length)
    for (const s of snapshots) {
      const own = new Set(s.items.map(i => i.id))
      for (const p of s.pending) expect(own.has(p.itemId!), p.requestId).toBe(true)
      for (const a of s.runs.agents) expect(own.has(a.toolUseId!), a.id).toBe(true)
      for (const w of s.runs.workflows) expect(own.has(w.toolUseId!), w.id).toBe(true)
      for (const t of s.tasks) expect(showcaseTaskOutput(s.record.id, t.id).output, t.id).not.toBe('')
    }
  })

  it('会话状态、条目类型和各种状态都覆盖到', () => {
    expect(new Set(snapshots.map(s => s.state))).toEqual(new Set(['idle', 'running', 'starting', 'waiting']))
    const every: Item['kind'][] = [
      'user',
      'assistant',
      'reasoning',
      'command',
      'file_change',
      'tool',
      'todo',
      'notice',
      'compaction',
      'turn_stats',
    ]
    for (const kind of every) expect(kinds(kind).length, kind).toBeGreaterThan(0)
    expect(new Set(kinds('command').map(c => c.status))).toEqual(
      new Set(['completed', 'failed', 'declined', 'interrupted', 'running']),
    )
    expect(new Set(kinds('tool').map(t => t.tool))).toEqual(new Set(['read', 'search', 'web', 'mcp', 'task', 'other']))
    expect(new Set(kinds('file_change').flatMap(f => f.changes.map(c => c.kind)))).toEqual(
      new Set(['add', 'update', 'delete']),
    )
    expect(kinds('file_change').some(f => f.changes.length > 1)).toBe(true)
    expect(new Set(kinds('notice').map(n => n.level))).toEqual(new Set(['info', 'warn', 'error']))
    expect(new Set(kinds('compaction').map(c => c.status))).toEqual(
      new Set(['running', 'completed', 'failed', 'interrupted']),
    )
    expect(new Set(kinds('turn_stats').map(t => t.outcome))).toEqual(new Set(['completed', 'interrupted', 'failed']))
    expect(kinds('assistant').some(a => a.status === 'interrupted')).toBe(true)
    expect(kinds('user').some(u => u.mode === 'guidance')).toBe(true)
    expect(kinds('user').some(u => u.attachments?.length)).toBe(true)
    expect(items.some(i => 'subagent' in i && i.subagent)).toBe(true)
    expect(new Set(snapshots.flatMap(s => s.pending.map(p => p.kind)))).toEqual(
      new Set(['command', 'file_change', 'tool', 'question', 'plan']),
    )
    expect(snapshots.some(s => s.record.platform)).toBe(true)
    expect(snapshots.some(s => s.retry)).toBe(true)
    expect(snapshots.some(s => s.queue.some(q => q.direct))).toBe(true)
  })

  it('提到的文件都在演示文件列表里（删掉的文件除外），点得开', () => {
    for (const f of kinds('file_change'))
      for (const c of f.changes) if (c.kind !== 'delete') expect(DEMO_FILES[c.path], c.path).toBeDefined()
    const text = kinds('assistant')
      .map(a => a.text)
      .join('\n')
    const paths = [...text.matchAll(/`((?:src|README)[^`\s]*\.\w+)(?::\d+)?`|\]\(((?:src|README)[^)#\s]*)/g)].map(
      m => m[1] ?? m[2],
    )
    expect(paths.length).toBeGreaterThan(3)
    for (const path of paths) expect(DEMO_FILES[path], path).toBeDefined()
  })

  it('图片附件是尺寸对得上的 PNG', () => {
    const images = kinds('user').flatMap(u => u.attachments ?? [])
    for (const image of images) {
      const bytes = Buffer.from(image.dataBase64, 'base64')
      expect(bytes.subarray(1, 4).toString(), image.name).toBe('PNG')
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.name).toEqual([image.width, image.height])
    }
  })

  it('参考图改动卡片的 diff 和卡片上的行数对得上（点文件行能展开）', () => {
    for (const f of demo.changedFiles!.files) {
      const lines = f.diffs!.flatMap(d => d.split('\n'))
      expect(
        [lines.filter(l => l.startsWith('+')).length, lines.filter(l => l.startsWith('-')).length],
        f.name,
      ).toEqual([f.added, f.removed])
    }
  })
})
