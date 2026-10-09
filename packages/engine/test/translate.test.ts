// 用录下来的真实 Claude Code 输出测翻译（test/fixtures，来自 2026-10-06 调研，路径已替换成 D:\work）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  emptySnapshot,
  reduce,
  type EngineEvent,
  type PermissionMode,
  type SessionRecord,
  type TurnOutcome,
} from '@pixelsky/protocol'
import { ClaudeTranslator } from '../src/claude/translate'

function fixture(name: string): Record<string, unknown>[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url)), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as Record<string, unknown>)
}

function translate(name: string, prepare?: (t: ClaudeTranslator) => void) {
  const events: EngineEvent[] = []
  const sessionIds: string[] = []
  const modes: PermissionMode[] = []
  const ends: TurnOutcome[] = []
  const t = new ClaudeTranslator('D:\\work', {
    emit: e => events.push(e),
    sessionId: id => sessionIds.push(id),
    permissionMode: m => modes.push(m),
    turnEnded: o => ends.push(o),
    fastState: () => {},
  })
  t.startTurn('turn-1')
  prepare?.(t)
  for (const m of fixture(name)) t.handle(m)
  return { events, sessionIds, modes, ends }
}

const record: SessionRecord = {
  id: 's',
  projectId: 'p',
  cwd: 'D:\\work',
  engine: 'claude',
  engineSessionId: null,
  title: 't',
  model: null,
  effort: null,
  permissionMode: 'ask',
  ultracode: false,
  fast: false,
  thinkingSummaries: true,
  createdAt: 0,
  updatedAt: 0,
  lastOutcome: null,
}

describe('ClaudeTranslator（真实录像）', () => {
  it('写文件 + 允许：文件改动条目、回复、用量、一轮完成', () => {
    const { events, sessionIds, modes, ends } = translate('claude-write-allow')
    expect(sessionIds[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(modes[0]).toBe('ask')
    expect(ends).toEqual(['completed'])

    const snap = events.reduce(reduce, emptySnapshot(record))
    const kinds = snap.items.map(i => i.kind)
    expect(kinds).toEqual(['file_change', 'assistant'])

    const fc = snap.items[0]
    expect(fc).toMatchObject({ kind: 'file_change', status: 'completed' })
    if (fc.kind === 'file_change') {
      expect(fc.changes).toEqual([{ path: 'hello.txt', kind: 'add', newText: 'hi', diff: '+hi', added: 1, removed: 0 }])
    }
    expect(snap.items[1]).toMatchObject({ kind: 'assistant', text: 'done', status: 'completed' })

    const usage = events.filter(e => e.type === 'usage').at(-1)
    expect(usage?.type === 'usage' && usage.usage.costUsd).toBeCloseTo(0.0952944)
    expect(usage?.type === 'usage' && usage.usage.contextWindow).toBe(1_000_000)
    expect(usage?.type === 'usage' && usage.usage.contextTokens).toBeGreaterThan(30_000)

    const done = events.at(-1)
    expect(done).toMatchObject({ type: 'turn_completed', turnId: 'turn-1', outcome: 'completed', error: null })
    // 这一轮的用量：一个模型、两次请求（工具调用一次 + 回复一次）
    const u = done?.type === 'turn_completed' ? done.usage : undefined
    expect(u?.models['claude-sonnet-5-5']).toMatchObject({
      input: 1198,
      cacheRead: 33742,
      cacheWrite: 33944,
      output: 129,
      requests: 2,
    })
    expect(u?.models['claude-sonnet-5-5'].costUsd).toBeCloseTo(0.0952944)
    expect(u?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('流式正文先 item_started 再增量，最后用完整内容完成', () => {
    const { events } = translate('claude-write-allow')
    const started = events.find(e => e.type === 'item_started' && e.item.kind === 'assistant')
    const deltas = events.filter(e => e.type === 'item_delta')
    expect(started).toBeTruthy()
    expect(deltas.map(d => (d.type === 'item_delta' ? d.delta : '')).join('')).toBe('done')
  })

  it('中断：回复标成 interrupted，一轮结果是 interrupted，不弹错误', () => {
    const { events, ends } = translate('claude-interrupt')
    expect(ends).toEqual(['interrupted'])
    const snap = events.reduce(reduce, emptySnapshot(record))
    expect(snap.items).toHaveLength(1)
    expect(snap.items[0]).toMatchObject({ kind: 'assistant', status: 'interrupted' })
    expect(snap.items.some(i => i.kind === 'notice')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'turn_completed', outcome: 'interrupted', error: null })
  })

  it('写文件被用户拒绝：条目标成 declined', () => {
    const toolUseId = (() => {
      for (const m of fixture('claude-write-deny')) {
        const content = (m.message as { content?: unknown })?.content
        if (m.type === 'assistant' && Array.isArray(content) && content[0]?.type === 'tool_use')
          return content[0].id as string
      }
      return ''
    })()
    const { events, ends } = translate('claude-write-deny', t => t.markDeclined(toolUseId))
    expect(ends).toEqual(['completed'])
    const snap = events.reduce(reduce, emptySnapshot(record))
    expect(snap.items[0]).toMatchObject({ kind: 'file_change', status: 'declined' })
    expect(snap.items[1]).toMatchObject({ kind: 'assistant', status: 'completed' })
  })

  it('没标记拒绝的出错工具：条目标成 failed', () => {
    const { events } = translate('claude-write-deny')
    const snap = events.reduce(reduce, emptySnapshot(record))
    expect(snap.items[0]).toMatchObject({ kind: 'file_change', status: 'failed' })
  })

  it('子 agent 的消息不进对话流', () => {
    const events: EngineEvent[] = []
    const t = new ClaudeTranslator('D:\\work', {
      emit: e => events.push(e),
      sessionId: () => {},
      permissionMode: () => {},
      turnEnded: () => {},
      fastState: () => {},
    })
    t.startTurn('t')
    t.handle({
      type: 'assistant',
      parent_tool_use_id: 'toolu_parent',
      message: { id: 'm', content: [{ type: 'text', text: '子任务内部' }] },
    })
    expect(events).toHaveLength(0)
  })

  it('用量按进程累计求差：同一进程里没有新 token 的一轮不带 usage；换进程后基线清零', () => {
    const events: EngineEvent[] = []
    const t = new ClaudeTranslator('D:\\work', {
      emit: e => events.push(e),
      sessionId: () => {},
      permissionMode: () => {},
      turnEnded: () => {},
      fastState: () => {},
    })
    const turn = (name: string, id: string) => {
      t.startTurn(id)
      for (const m of fixture(name)) t.handle(m)
      const done = events.filter(e => e.type === 'turn_completed').at(-1)
      return done?.type === 'turn_completed' ? done.usage : undefined
    }
    expect(turn('claude-write-allow', 't1')?.models['claude-sonnet-5-5'].input).toBe(1198)
    // 录像里中断那一轮的累计值和上一轮一样：这一轮没有新用量
    expect(turn('claude-interrupt', 't2')).toBeUndefined()
    // 新进程：同样的累计值整个算这一轮
    t.resetUsageBaseline()
    expect(turn('claude-interrupt', 't3')?.models['claude-sonnet-5-5'].input).toBe(1198)
  })
})
