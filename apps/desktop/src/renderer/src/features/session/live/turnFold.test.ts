// 每轮的过程收成「执行」一行（docs/ui/conversation-concise.md §3）
import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { foldTurns, summarize, type Entry } from './turnFold'

const user = (id: string, mode?: 'guidance'): Item => ({ kind: 'user', id, text: id, createdAt: 0, mode })
const say = (id: string, status: 'completed' | 'running' | 'interrupted' = 'completed'): Item => ({
  kind: 'assistant',
  id,
  text: id,
  status,
})
const think = (id: string): Item => ({ kind: 'reasoning', id, text: id, status: 'completed' })
const run = (id: string, status: 'completed' | 'failed' | 'running' = 'completed'): Item => ({
  kind: 'command',
  id,
  command: id,
  description: null,
  output: '',
  exitCode: 0,
  status,
})
const read = (id: string): Item => ({
  kind: 'tool',
  id,
  tool: 'read',
  name: 'Read',
  title: id,
  output: '',
  status: 'completed',
})
const edit = (id: string, path: string): Item => ({
  kind: 'file_change',
  id,
  changes: [{ path, kind: 'update', diff: '', added: 1, removed: 0 }],
  status: 'completed',
})
const notice = (id: string, level: 'info' | 'warn' | 'error'): Item => ({ kind: 'notice', id, level, text: id })
const stats = (id: string): Item => ({
  kind: 'turn_stats',
  id,
  turnId: id,
  outcome: 'completed',
  usage: { durationMs: 1234, models: {} },
})

/** 显示顺序：条目写 id，执行块写 [里面的 id] */
const shape = (entries: Entry[]): (string | string[])[] =>
  entries.map(e => (e.type === 'item' ? e.item.id : e.items.map(i => i.id)))

describe('每轮的过程收成执行块', () => {
  it('思考、工具、过渡话收进去；最后的回复、统计行一直显示；执行块带上这一轮的用时', () => {
    const entries = foldTurns([user('u1'), think('r'), say('a1'), read('t1'), run('c1'), say('a2'), stats('s')], false)
    expect(shape(entries)).toEqual(['u1', ['r', 'a1', 't1', 'c1'], 'a2', 's'])
    expect(entries[1]).toMatchObject({ running: false, durationMs: 1234 })
  })

  it('引导、警告和错误一直显示，排在执行块后面；信息提示收进去', () => {
    const entries = foldTurns(
      [user('u1'), run('c1'), user('g', 'guidance'), notice('i', 'info'), run('c2'), notice('e', 'error'), say('a')],
      false,
    )
    expect(shape(entries)).toEqual(['u1', ['c1', 'i', 'c2'], 'g', 'e', 'a'])
  })

  it('运行中：最后是工具调用时没有最后的回复，正在输出的文字留在外面', () => {
    expect(shape(foldTurns([user('u1'), say('a1'), run('c1', 'running')], true))).toEqual(['u1', ['a1', 'c1']])
    const streaming = foldTurns([user('u1'), run('c1'), say('a2', 'running')], true)
    expect(shape(streaming)).toEqual(['u1', ['c1'], 'a2'])
    expect(streaming[1]).toMatchObject({ running: true })
    // 只有最后一轮算运行中
    const two = foldTurns([user('u1'), run('c1'), say('a'), user('u2'), run('c2', 'running')], true)
    expect(two.filter(e => e.type === 'process').map(e => e.type === 'process' && e.running)).toEqual([false, true])
  })

  it('只有一段思考或一条提示、没有工具调用时照原样显示；中断的回复算最后的回复', () => {
    expect(shape(foldTurns([user('u1'), think('r'), say('a')], false))).toEqual(['u1', 'r', 'a'])
    expect(shape(foldTurns([user('u1'), run('c1'), say('a', 'interrupted')], false))).toEqual(['u1', ['c1'], 'a'])
    expect(shape(foldTurns([user('u1'), notice('e', 'error'), stats('s')], false))).toEqual(['u1', 'e', 's'])
  })
})

describe('执行行的概要', () => {
  it('按类数，同一个文件算一次，失败的单独数', () => {
    expect(
      summarize([
        run('c1'),
        run('c2', 'failed'),
        read('t1'),
        edit('f1', 'a.ts'),
        edit('f2', 'a.ts'),
        edit('f3', 'b.ts'),
      ]),
    ).toMatchObject({ commands: 2, reads: 1, edits: 2, failed: 1 })
  })
})
