// 截断点在上下文压缩之前时，自己复制 Claude Code 的记录（docs/ui/rewind-fork-sidechat.md §2.4）
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  anchorPosition,
  copyTranscriptUntil,
  currentLeaf,
  findRewindAnchor,
  pointLastPrompt,
  seedTranscript,
  seedUuid,
} from '../src/claude/transcript'

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

describe('跨引擎接力：把聊天写进 Claude Code 的记录', () => {
  const uuid = '11111111-2222-4333-8444-555555555555'
  const read = (path: string) =>
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .flatMap(l => {
        try {
          return [JSON.parse(l) as Record<string, unknown>]
        } catch {
          return []
        }
      })

  it('没有记录时新建：用户和助手交替，从头接成一条链', () => {
    const path = seedTranscript(
      dir,
      '/work/proj',
      'fresh',
      [
        { id: uuid, user: '问', assistant: '答' },
        { id: 'not-a-uuid', user: '再问', assistant: null },
      ],
      '（没回复）',
    )
    expect(path).toBe(join(dir, '-work-proj', 'fresh.jsonl'))
    const lines = read(path)
    expect(lines.map(l => l.type)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(lines[0]).toMatchObject({
      parentUuid: null,
      uuid,
      sessionId: 'fresh',
      message: { role: 'user', content: '问' },
    })
    expect(lines[1]).toMatchObject({ parentUuid: uuid, message: { content: [{ type: 'text', text: '答' }] } })
    // 不是 uuid 的条目 id 换成新的，链照样接上
    expect(lines[2].uuid).not.toBe('not-a-uuid')
    expect(lines[2].parentUuid).toBe(lines[1].uuid)
    expect(lines[3]).toMatchObject({ message: { content: [{ type: 'text', text: '（没回复）' }] } })
    // 回退时按我们的条目 id 照样找得到截断点
    expect(findRewindAnchor(path, [uuid])).toEqual({ at: null })
    expect(currentLeaf(path)).toBe(lines[3].uuid)
  })

  it('已有记录时接在当前末端后面，并让 last-prompt 指向新末端', () => {
    // Claude Code 的记录放在项目目录下：<projects>/<编码后的工作目录>/<会话 id>.jsonl
    const existing = join(dir, '-work-proj', 'old.jsonl')
    mkdirSync(join(dir, '-work-proj'))
    writeFileSync(existing, readFileSync(file))
    const path = seedTranscript(dir, '/work/proj', 'old', [{ id: uuid, user: '问', assistant: '答' }], '')
    expect(path).toBe(existing)
    const lines = read(path)
    const seeded = lines.filter(l => l.sessionId === 'old' && (l.type === 'user' || l.type === 'assistant')).slice(-2)
    expect(seeded[0]).toMatchObject({ uuid, parentUuid: 'u2' })
    expect(lines.at(-1)).toMatchObject({ type: 'last-prompt', leafUuid: seeded[1].uuid })
  })

  it('不是 UUID 的条目 id 每次得到同一个 UUID，回退时按条目 id 找得到', () => {
    expect(seedUuid(uuid)).toBe(uuid)
    expect(seedUuid('m1-retry-x')).toBe(seedUuid('m1-retry-x'))
    expect(seedUuid('m1-retry-x')).not.toBe(seedUuid('m1-retry-y'))
    expect(seedUuid('m1-retry-x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const path = seedTranscript(dir, '/work/proj', 'retry', [{ id: 'm1-retry-x', user: '问', assistant: '答' }], '')
    expect(read(path)[0].uuid).toBe(seedUuid('m1-retry-x'))
    expect(findRewindAnchor(path, ['m1-retry-x'])).toEqual({ at: null })
  })

  it('已经在当前分支上的轮次和它之前的不再写：uuid 不重复，parentUuid 不成环', () => {
    const existing = join(dir, '-work-proj', 'old.jsonl')
    mkdirSync(join(dir, '-work-proj'))
    // Claude 自己收到过 c（那一轮失败了，游标没推进），压缩之前还有 a
    const chain = [
      { type: 'user', uuid: 'a', parentUuid: null },
      { type: 'assistant', uuid: 'ra', parentUuid: 'a' },
      { type: 'system', subtype: 'compact_boundary', uuid: 'cb', parentUuid: null, logicalParentUuid: 'ra' },
      { type: 'user', uuid: 'c', parentUuid: 'cb' },
      { type: 'assistant', uuid: 'rc', parentUuid: 'c' },
    ]
    writeFileSync(existing, chain.map(r => JSON.stringify(r)).join('\n') + '\n')
    const turn = (id: string) => ({ id, user: id, assistant: null })
    seedTranscript(dir, '/work/proj', 'old', [turn('a'), turn('c')], '')
    expect(readFileSync(existing, 'utf8')).toBe(chain.map(r => JSON.stringify(r)).join('\n') + '\n')
    // 之后的新轮次照常接在末端
    seedTranscript(dir, '/work/proj', 'old', [turn('a'), turn('c'), turn('d')], '')
    const added = read(existing)
      .filter(l => l.type === 'user' || l.type === 'assistant')
      .slice(chain.length - 1)
    expect(added[0]).toMatchObject({ uuid: seedUuid('d'), parentUuid: 'rc' })
    const uuids = read(existing).flatMap(l => (typeof l.uuid === 'string' ? [l.uuid] : []))
    expect(new Set(uuids).size).toBe(uuids.length)
  })

  it('别的分支上已有同一个 uuid：换一个新的写，不重复', () => {
    const existing = join(dir, '-work-proj', 'old.jsonl')
    mkdirSync(join(dir, '-work-proj'))
    const chain = [
      { type: 'user', uuid: seedUuid('x'), parentUuid: null },
      { type: 'user', uuid: 'y', parentUuid: null },
    ]
    writeFileSync(existing, chain.map(r => JSON.stringify(r)).join('\n') + '\n')
    seedTranscript(dir, '/work/proj', 'old', [{ id: 'x', user: 'x', assistant: null }], '')
    const users = read(existing).filter(l => l.type === 'user')
    expect(users[2]).toMatchObject({ parentUuid: 'y' })
    expect(users[2].uuid).not.toBe(seedUuid('x'))
  })

  it('回退截断点：同一个 uuid 重复出现时以第一次为准', () => {
    const broken = join(dir, 'broken.jsonl')
    const chain = [
      { type: 'user', uuid: 'a', parentUuid: null },
      { type: 'assistant', uuid: 'ra', parentUuid: 'a' },
      { type: 'user', uuid: 'c', parentUuid: 'ra' },
      { type: 'assistant', uuid: 'rc', parentUuid: 'c' },
      { type: 'user', uuid: 'c', parentUuid: 'rc' },
    ]
    writeFileSync(broken, chain.map(r => JSON.stringify(r)).join('\n') + '\n')
    expect(findRewindAnchor(broken, ['c'])).toEqual({ at: 'ra' })
  })
})
