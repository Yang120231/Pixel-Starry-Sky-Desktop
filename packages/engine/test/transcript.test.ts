// 截断点在上下文压缩之前时，自己复制 Claude Code 的记录（docs/ui/rewind-fork-sidechat.md §2.4）
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anchorPosition, copyTranscriptUntil, currentLeaf, pointLastPrompt } from '../src/claude/transcript'

let dir: string
let file: string
const rows = [
  { type: 'user', uuid: 'u1', parentUuid: null, sessionId: 'old' },
  { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 'old' },
  { type: 'system', subtype: 'compact_boundary', uuid: 'b1', parentUuid: null, sessionId: 'old' },
  { type: 'user', uuid: 'u2', parentUuid: 'b1', sessionId: 'old' },
]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pixelsky-transcript-'))
  file = join(dir, 'old.jsonl')
  writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n不是 JSON\n')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Claude Code 记录的截断点', () => {
  it('最近一次压缩之前是 compacted，之后是 loaded，没有是 null', () => {
    expect(anchorPosition(file, 'a1')).toBe('compacted')
    expect(anchorPosition(file, 'b1')).toBe('compacted')
    expect(anchorPosition(file, 'u2')).toBe('loaded')
    expect(anchorPosition(file, 'nope')).toBeNull()
  })

  it('复制到截断点为止，换成新的会话 id；已有同名记录不覆盖', () => {
    const copied = copyTranscriptUntil(file, 'a1', 'new')
    expect(copied).toBe(join(dir, 'new.jsonl'))
    const lines = readFileSync(copied!, 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as Record<string, unknown>)
    expect(lines.map(l => l.uuid)).toEqual(['u1', 'a1'])
    expect(lines.every(l => l.sessionId === 'new')).toBe(true)
    expect(() => copyTranscriptUntil(file, 'a1', 'new')).toThrow()
    expect(copyTranscriptUntil(file, 'nope', 'other')).toBeNull()
  })
})

// GitHub #82：辅助进程用 --resume-session-at 读当前分支，不靠 Claude Code 退出时才写的 last-prompt
describe('当前分支的最后一条', () => {
  const write = (lines: unknown[]): void =>
    writeFileSync(file, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')

  it('取主线上最后写进去的 user / assistant；跳过子智能体、快照、last-prompt 和写坏的行', () => {
    write([
      { type: 'user', uuid: 'u1', parentUuid: null },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1' },
      // 回退后接着聊：新分支从 a0 接出去，写在旧分支后面
      { type: 'user', uuid: 'u6', parentUuid: 'a0' },
      { type: 'assistant', uuid: 'a6', parentUuid: 'u6' },
      { type: 'assistant', uuid: 'side', parentUuid: 'a6', isSidechain: true },
      { type: 'file-history-snapshot', messageId: 'u6', snapshot: {} },
      { type: 'last-prompt', leafUuid: 'a1' },
      '{"type":"user","uuid":',
    ])
    expect(currentLeaf(file)).toBe('a6')
  })

  it('记录很大时只读末尾一段，半截的第一行不算；整段都没有消息时 null', () => {
    const big = 'x'.repeat(300 * 1024)
    write([
      { type: 'user', uuid: 'early', parentUuid: null, text: big },
      { type: 'assistant', uuid: 'leaf', parentUuid: 'early' },
      { type: 'cost-state', text: big },
    ])
    expect(currentLeaf(file)).toBe('leaf')
    write([
      { type: 'user', uuid: 'only', parentUuid: null, text: big },
      { type: 'cost-state', text: big },
    ])
    expect(currentLeaf(file)).toBe('only')
    write([{ type: 'queue-operation' }, { type: 'last-prompt', leafUuid: 'x' }])
    expect(currentLeaf(file)).toBeNull()
  })

  it('last-prompt 不是当前末端时补一条（沿用上一条的 lastPrompt），已经是就不写', () => {
    write([
      { type: 'user', uuid: 'u1', parentUuid: null },
      { type: 'assistant', uuid: 'a5', parentUuid: 'u1' },
      { type: 'last-prompt', lastPrompt: '旧的', leafUuid: 'a5', sessionId: 's' },
      { type: 'user', uuid: 'u6', parentUuid: 'u1' },
      { type: 'assistant', uuid: 'a6', parentUuid: 'u6' },
    ])
    pointLastPrompt(file, 's')
    const lines = () => readFileSync(file, 'utf8').trim().split('\n')
    expect(JSON.parse(lines().at(-1)!)).toEqual({
      type: 'last-prompt',
      lastPrompt: '旧的',
      leafUuid: 'a6',
      sessionId: 's',
    })
    const count = lines().length
    pointLastPrompt(file, 's')
    expect(lines()).toHaveLength(count)
  })
})
