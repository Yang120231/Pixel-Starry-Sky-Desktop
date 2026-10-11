// 截断点在上下文压缩之前时，自己复制 Claude Code 的记录（docs/ui/rewind-fork-sidechat.md §2.4）
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anchorPosition, copyTranscriptUntil } from '../src/claude/transcript'

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
