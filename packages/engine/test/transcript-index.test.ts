// 记录索引：流式建索引，回退 / 分叉读记录的三个函数改成用它之后结果不变（docs/ui/claude-resume.md §4.7）
import {
  appendFileSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
  closeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anchorPosition, copyTranscriptUntil, findRewindAnchor, scanBack } from '../src/claude/transcript'
import { clearTranscriptIndexCache, leafOf, transcriptIndex } from '../src/claude/transcript-index'

// ---- 旧实现（整份 readFileSync），留一份做对比 ----
function oldFindRewindAnchor(file: string, userIds: string[]): { at: string | null } | null {
  const parents = new Map<string, string | null>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { type?: unknown; uuid?: unknown; parentUuid?: unknown; isSidechain?: unknown }
      if (e.type === 'user' && typeof e.uuid === 'string' && e.isSidechain !== true)
        parents.set(e.uuid, typeof e.parentUuid === 'string' ? e.parentUuid : null)
    } catch {
      // 跳过写坏的行
    }
  }
  for (const id of userIds) if (parents.has(id)) return { at: parents.get(id) ?? null }
  return null
}

function oldAnchorPosition(file: string, at: string): 'loaded' | 'compacted' | null {
  let index = -1
  let boundary = -1
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return
      try {
        const e = JSON.parse(line) as { type?: unknown; subtype?: unknown; uuid?: unknown; isSidechain?: unknown }
        if (e.uuid === at && index < 0) index = i
        if (e.type === 'system' && e.subtype === 'compact_boundary' && e.isSidechain !== true) boundary = i
      } catch {
        // 跳过写坏的行
      }
    })
  if (index < 0) return null
  return index > boundary ? 'loaded' : 'compacted'
}

function oldCopy(file: string, at: string, sessionId: string): string | null {
  const out: string[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof e.sessionId === 'string') e.sessionId = sessionId
    out.push(JSON.stringify(e))
    if (e.uuid === at) {
      const path = join(dirname(file), `${sessionId}.jsonl`)
      writeFileSync(path, out.join('\n') + '\n', { flag: 'wx' })
      return path
    }
  }
  return null
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pixelsky-tindex-'))
  clearTranscriptIndexCache()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const lines = (rows: unknown[]): string =>
  rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n'

/** 各种形状的记录：回退旁支、压缩边界（带 / 不带保留段）、写坏的行、空行、子智能体行、重复 uuid、半截末行 */
const fixtures: Record<string, string> = {
  basic: lines([
    { type: 'user', uuid: 'u1', parentUuid: null, sessionId: 'old' },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 'old' },
    { type: 'system', subtype: 'compact_boundary', uuid: 'b1', parentUuid: null, sessionId: 'old' },
    { type: 'user', uuid: 'u2', parentUuid: 'b1', sessionId: 'old' },
    '不是 JSON',
  ]),
  branches: lines([
    { type: 'user', uuid: 'u1', parentUuid: null, sessionId: 's' },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 's' },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', sessionId: 's' },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', sessionId: 's' },
    // 回退到 a1 之后接着聊：新分支写在旧分支后面
    { type: 'user', uuid: 'u3', parentUuid: 'a1', sessionId: 's' },
    { type: 'assistant', uuid: 'a3', parentUuid: 'u3', sessionId: 's' },
    { type: 'user', uuid: 'side', parentUuid: 'a3', isSidechain: true, sessionId: 's' },
    '',
    '   ',
    { type: 'user', uuid: 'u2', parentUuid: 'a3', sessionId: 's' },
    { type: 'file-history-snapshot', messageId: 'u3', snapshot: {} },
    '123',
    '{"type":"user","uuid":"half","parentUu',
  ]),
  boundaries: lines([
    { type: 'user', uuid: 'u1', parentUuid: null, sessionId: 's' },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 's' },
    {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b1',
      parentUuid: null,
      logicalParentUuid: 'a1',
      sessionId: 's',
    },
    {
      type: 'user',
      uuid: 'sum1',
      parentUuid: 'b1',
      isCompactSummary: true,
      sessionId: 's',
    },
    { type: 'user', uuid: 'u2', parentUuid: 'sum1', sessionId: 's' },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', sessionId: 's' },
    // 子智能体里的压缩边界不算
    { type: 'system', subtype: 'compact_boundary', uuid: 'bx', parentUuid: null, isSidechain: true, sessionId: 's' },
    {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b2',
      parentUuid: null,
      logicalParentUuid: 'a2',
      sessionId: 's',
    },
    { type: 'user', uuid: 'u3', parentUuid: 'b2', sessionId: 's' },
  ]),
  boundaryLast: lines([
    { type: 'user', uuid: 'u1', parentUuid: null },
    { type: 'system', subtype: 'compact_boundary', uuid: 'b1', parentUuid: null },
  ]),
  noTrailingNewline:
    '{"type":"user","uuid":"u1","parentUuid":null}\n{"type":"assistant","uuid":"a1","parentUuid":"u1"}',
  empty: '',
}

const IDS = ['u1', 'u2', 'u3', 'a1', 'a2', 'a3', 'b1', 'b2', 'bx', 'sum1', 'side', 'half', 'nope']

describe('新旧读记录的函数结果一模一样', () => {
  for (const [name, content] of Object.entries(fixtures)) {
    for (const chunk of [undefined, 7]) {
      it(`${name}${chunk ? `（块 ${chunk} 字节）` : ''}`, async () => {
        const file = join(dir, `${name}.jsonl`)
        writeFileSync(file, content)
        clearTranscriptIndexCache()
        if (chunk) await transcriptIndex(file, { chunk })
        for (const id of IDS) {
          expect(await anchorPosition(file, id), `anchorPosition ${id}`).toBe(oldAnchorPosition(file, id))
          expect(await findRewindAnchor(file, [id]), `anchor ${id}`).toEqual(oldFindRewindAnchor(file, [id]))
        }
        expect(await findRewindAnchor(file, ['nope', 'u2', 'u1'])).toEqual(
          oldFindRewindAnchor(file, ['nope', 'u2', 'u1']),
        )
        expect(await findRewindAnchor(file, [])).toEqual(oldFindRewindAnchor(file, []))
        for (const id of IDS) {
          const a = oldCopy(file, id, `old-${id}`)
          const b = await copyTranscriptUntil(file, id, `new-${id}`)
          expect(b === null, `copy ${id}`).toBe(a === null)
          if (a && b) {
            const read = (p: string, sid: string) => readFileSync(p, 'utf8').replaceAll(sid, 'SID')
            expect(read(b, `new-${id}`)).toBe(read(a, `old-${id}`))
          }
        }
      })
    }
  }

  it('大块里夹着长行时按行位置读出来也对', async () => {
    const file = join(dir, 'long.jsonl')
    const big = 'x'.repeat(200_000)
    writeFileSync(
      file,
      lines([
        { type: 'user', uuid: 'u1', parentUuid: null, text: big },
        { type: 'assistant', uuid: 'a1', parentUuid: 'u1', text: big },
        { type: 'user', uuid: 'u2', parentUuid: 'a1' },
      ]),
    )
    expect(await findRewindAnchor(file, ['u2'])).toEqual(oldFindRewindAnchor(file, ['u2']))
    expect(await anchorPosition(file, 'a1')).toBe('loaded')
  })
})

describe('当前分支的末端', () => {
  it('last-prompt 比最后的消息新用它的 leafUuid（可以是 system 行），旧就用最后一条 user / assistant', async () => {
    const file = join(dir, 'leaf.jsonl')
    writeFileSync(
      file,
      lines([
        { type: 'user', uuid: 'u1', parentUuid: null },
        { type: 'assistant', uuid: 'a1', parentUuid: 'u1' },
        { type: 'system', subtype: 'turn_duration', uuid: 'sys', parentUuid: 'a1' },
        { type: 'last-prompt', lastPrompt: 'x', leafUuid: 'sys' },
      ]),
    )
    expect(leafOf(await transcriptIndex(file))).toBe('sys')
    appendFileSync(file, lines([{ type: 'user', uuid: 'u2', parentUuid: 'a1' }]))
    expect(leafOf(await transcriptIndex(file))).toBe('u2')
    // leafUuid 不在记录里时不信它
    appendFileSync(file, lines([{ type: 'last-prompt', lastPrompt: 'x', leafUuid: 'gone' }]))
    expect(leafOf(await transcriptIndex(file))).toBe('u2')
  })
})

describe('索引缓存', () => {
  it('文件只是变长了：接着建，不重来；半截末行下次从那一行接着读', async () => {
    const file = join(dir, 'grow.jsonl')
    writeFileSync(
      file,
      lines([{ type: 'user', uuid: 'u1', parentUuid: null }]) + '{"type":"assistant","uuid":"a1","par',
    )
    const first = await transcriptIndex(file)
    const u1 = first.rows.get('u1')
    expect(first.lines).toBe(1)
    expect(first.rows.has('a1')).toBe(false)
    // 补完那一行，再追加一行
    appendFileSync(file, 'entUuid":"u1"}\n' + lines([{ type: 'user', uuid: 'u2', parentUuid: 'a1' }]))
    const second = await transcriptIndex(file)
    expect(second).toBe(first)
    expect(second.rows.get('u1')).toBe(u1)
    expect(second.rows.get('a1')).toMatchObject({ parent: 'u1', line: 1 })
    expect(second.rows.get('u2')).toMatchObject({ parent: 'a1', line: 2 })
    expect(second.lines).toBe(3)
    // 没变就直接给缓存
    expect(await transcriptIndex(file)).toBe(second)
  })

  it('末行能解析但没有换行：重读那一行不会变成重复', async () => {
    const file = join(dir, 'tail.jsonl')
    writeFileSync(
      file,
      '{"type":"user","uuid":"u1","parentUuid":null}\n{"type":"assistant","uuid":"a1","parentUuid":"u1"}',
    )
    const first = await transcriptIndex(file)
    expect(first.rows.get('a1')?.first).toBeUndefined()
    appendFileSync(file, '\n{"type":"user","uuid":"u2","parentUuid":"a1"}\n')
    const second = await transcriptIndex(file)
    expect(second.rows.get('a1')?.first).toBeUndefined()
    expect(second.rows.get('u2')?.line).toBe(2)
  })

  it('变短了或开头变了：整个重建', async () => {
    const file = join(dir, 'shrink.jsonl')
    writeFileSync(
      file,
      lines([
        { type: 'user', uuid: 'u1', parentUuid: null },
        { type: 'user', uuid: 'u2', parentUuid: 'u1' },
      ]),
    )
    const first = await transcriptIndex(file)
    expect(first.rows.size).toBe(2)
    writeFileSync(file, lines([{ type: 'user', uuid: 'x1', parentUuid: null }]))
    const shrunk = await transcriptIndex(file)
    expect(shrunk).not.toBe(first)
    expect([...shrunk.rows.keys()]).toEqual(['x1'])
    // 同样长或更长、但开头换了
    writeFileSync(
      file,
      lines([
        { type: 'user', uuid: 'y1', parentUuid: null },
        { type: 'user', uuid: 'y2', parentUuid: 'y1' },
      ]),
    )
    const swapped = await transcriptIndex(file)
    expect(swapped).not.toBe(shrunk)
    expect([...swapped.rows.keys()]).toEqual(['y1', 'y2'])
  })

  it('中途取消：抛出，已读的留在缓存里，下次接着读', async () => {
    const file = join(dir, 'abort.jsonl')
    writeFileSync(
      file,
      lines(
        Array.from({ length: 200 }, (_, i) => ({ type: 'user', uuid: `u${i}`, parentUuid: i ? `u${i - 1}` : null })),
      ),
    )
    const ctl = new AbortController()
    const seen: number[] = []
    await expect(
      transcriptIndex(file, {
        chunk: 512,
        signal: ctl.signal,
        onProgress: read => {
          seen.push(read)
          if (seen.length === 2) ctl.abort()
        },
      }),
    ).rejects.toThrow()
    expect(seen).toEqual([512, 1024])
    const done = await transcriptIndex(file, { chunk: 512 })
    expect(done.rows.size).toBe(200)
    expect(done.lines).toBe(200)
    // 进度按字节递增
    const progress: number[] = []
    writeFileSync(file, readFileSync(file, 'utf8') + lines([{ type: 'user', uuid: 'more', parentUuid: 'u199' }]))
    await transcriptIndex(file, { chunk: 100, onProgress: read => progress.push(read) })
    expect(progress.length).toBeGreaterThan(0)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  })
})

describe('scanBack 的 maxBytes', () => {
  it('只读末尾这么多字节，找不到就当没有；不传时一直读到开头', () => {
    const file = join(dir, 'scan.jsonl')
    const big = 'x'.repeat(100 * 1024)
    writeFileSync(
      file,
      lines([
        { type: 'first', n: 1 },
        { type: 'filler', text: big },
        { type: 'filler', text: big },
      ]),
    )
    const pick = (e: Record<string, unknown>) => (e.type === 'first' ? 1 : null)
    expect(scanBack(file, pick)).toBe(1)
    expect(scanBack(file, pick, 64 * 1024)).toBeNull()
    expect(scanBack(file, pick, 10 * 1024 * 1024)).toBe(1)
    const tail = (e: Record<string, unknown>) => (e.type === 'filler' ? 'filler' : null)
    expect(scanBack(file, tail, 1024)).toBeNull()
    expect(scanBack(file, tail, 256 * 1024)).toBe('filler')
  })
})

// 大记录：建索引时主进程的事件循环不能被卡住（§4.7）
describe('大记录不卡事件循环', () => {
  it('64 MB 的记录建索引：事件循环停顿低于 100 ms，结果正确', async () => {
    const file = join(dir, 'big.jsonl')
    const mb = process.env.CI ? 24 : 64
    const fd = openSync(file, 'w')
    const filler = 'y'.repeat(1200)
    let rows = 0
    let parent: string | null = null
    let batch: string[] = []
    const flush = () => {
      writeSync(fd, batch.join(''))
      batch = []
    }
    for (let size = 0; size < mb * 1024 * 1024; ) {
      const type = rows % 2 === 0 ? 'user' : 'assistant'
      const uuid = `row-${rows}`
      const line = JSON.stringify({ type, uuid, parentUuid: parent, message: { role: type, content: filler } }) + '\n'
      batch.push(line)
      size += line.length
      parent = uuid
      rows++
      if (batch.length >= 2000) flush()
    }
    flush()
    closeSync(fd)

    let worst = 0
    const run = async (): Promise<void> => {
      let last = performance.now()
      const timer = setInterval(() => {
        const now = performance.now()
        worst = Math.max(worst, now - last - 5)
        last = now
      }, 5)
      try {
        clearTranscriptIndexCache()
        const idx = await transcriptIndex(file)
        expect(idx.rows.size).toBe(rows)
        expect(idx.lines).toBe(rows)
        expect(leafOf(idx)).toBe(`row-${rows - 1}`)
      } finally {
        clearInterval(timer)
      }
    }
    await run()
    // 机器忙的时候偶尔会被系统调度拖一下：再量一次，两次都超才算
    if (worst >= 100) {
      const first = worst
      worst = 0
      await run()
      worst = Math.min(first, worst)
    }
    expect(worst).toBeLessThan(100)
  }, 60_000)
})
