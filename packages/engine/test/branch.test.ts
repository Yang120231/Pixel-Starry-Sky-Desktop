// 回退恢复代码 / 撤销、分叉、旁聊（docs/ui/rewind-fork-sidechat.md），用假 Claude（模拟记录链和 rewind_files）
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostEvent } from '@pixelsky/protocol'
import { ClaudeAdapter, EngineHost } from '../src'
import { parseRewindReply, parseSideAnswer, sideQuestionArgs } from '../src/claude/helper'
import { claudeArgs } from '../src/claude/session'
import { sidePrompt } from '../src/host/branch'

const FAKE = fileURLToPath(new URL('./fakes/fake-claude.mjs', import.meta.url))

let root: string
let events: HostEvent[]
let hosts: EngineHost[]

function makeHost(extraEnv: NodeJS.ProcessEnv = {}): EngineHost {
  const projectsDir = join(root, 'claude-projects')
  const adapter = new ClaudeAdapter({
    launcher: { command: process.execPath, args: [FAKE] },
    projectsDir,
    env: {
      ...process.env,
      FAKE_CLAUDE_PROJECTS: projectsDir,
      FAKE_CLAUDE_LOG: join(root, 'argv.log'),
      FAKE_CLAUDE_CHAIN: '1',
      FAKE_CLAUDE_CHAIN_LOG: join(root, 'chain.log'),
      ...extraEnv,
    },
  })
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    emit: e => events.push(e),
    idleMs: 60_000,
    adapters: { claude: adapter },
  })
  hosts.push(host)
  return host
}

const spawnArgs = (): string[][] =>
  readFileSync(join(root, 'argv.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as string[])
const visible = (): string[][] =>
  readFileSync(join(root, 'chain.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as string[])
const turnsDone = (id: string): number =>
  events.filter(e => e.kind === 'session' && e.sessionId === id && e.event.type === 'turn_completed').length
const userTexts = (host: EngineHost, id: string): string[] =>
  host.open(id).items.flatMap(i => (i.kind === 'user' ? [i.text] : []))

async function waitFor<T>(pick: () => T | undefined | null | false, timeoutMs = 10_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = pick()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error('等待超时')
    await new Promise(r => setTimeout(r, 20))
  }
}

async function conversation(host: EngineHost, texts: string[]) {
  const project = host.addProject(mkdtempSync(join(root, 'proj-')))
  const record = host.createSession({ projectId: project.id, permissionMode: 'ask', effort: 'high' })
  for (const [i, text] of texts.entries()) {
    await host.send(record.id, { text, clientMessageId: `m${i}` })
    await waitFor(() => turnsDone(record.id) === i + 1)
  }
  return { record, cwd: project.path }
}

/** 在记录末尾加一条压缩分界，之前的条目 Claude Code 就加载不到了；返回记录文件 */
function compact(cwd: string, sid: string): string {
  const file = join(root, 'claude-projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`)
  appendFileSync(
    file,
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', parentUuid: null }) + '\n',
  )
  return file
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-branch-'))
  events = []
  hosts = []
})

afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  rmSync(root, { recursive: true, force: true })
})

describe('辅助进程的参数和回复', () => {
  it('rewind_files 回复：文件列表、没有检查点、其他失败', () => {
    expect(parseRewindReply({ canRewind: true, filesChanged: ['/a', 3], insertions: 2, deletions: 1 })).toEqual({
      ok: true,
      files: ['/a'],
      insertions: 2,
      deletions: 1,
    })
    expect(parseRewindReply({ canRewind: false, error: 'No file checkpoint found for this message.' })).toMatchObject({
      ok: false,
      reason: 'no-checkpoint',
    })
    expect(parseRewindReply({ canRewind: false, error: 'disk full' })).toMatchObject({ ok: false, reason: 'failed' })
  })

  it('旁聊：不保存、没有工具、带模型；结果 JSON，is_error 当错误', () => {
    expect(sideQuestionArgs(['--resume', 's'], 'opus')).toEqual([
      '-p',
      '--output-format',
      'json',
      '--resume',
      's',
      '--fork-session',
      '--no-session-persistence',
      '--tools',
      '',
      '--model',
      'opus',
    ])
    expect(parseSideAnswer('noise\n{"type":"result","result":"好","is_error":false}\n')).toBe('好')
    expect(() => parseSideAnswer('{"result":"额度用完","is_error":true}')).toThrow('额度用完')
    expect(sidePrompt('再问', [{ question: '先问', answer: '先答' }])).toMatch(/问：先问\n答：先答\n\n问：再问$/)
  })

  it('分叉的启动参数：从原会话的截断点复制，用新 id 保存', () => {
    const settings = {
      model: null,
      effort: null,
      permissionMode: 'ask' as const,
      ultracode: false,
      fast: false,
      thinkingSummaries: true,
    }
    const args = claudeArgs(settings, 'new', false, undefined, null, { from: 'old', at: 'u1' })
    expect(args.slice(-6)).toEqual([
      '--resume',
      'old',
      '--fork-session',
      '--session-id',
      'new',
      '--resume-session-at=u1',
    ])
  })
})

describe('回退：对话 / 代码 / 两者，撤销', () => {
  it('预览列出要还原的文件；两者都恢复后文件和对话都回去，撤销后都回来', async () => {
    const file = join(root, 'a.txt')
    const host = makeHost({ FAKE_CLAUDE_REWIND: JSON.stringify({ file, content: 'old' }) })
    const { record } = await conversation(host, ['一', '二', '三'])
    writeFileSync(file, 'new')
    const preview = await host.rewindPreview(record.id, 'm1')
    expect(preview.code).toEqual({ ok: true, files: [file], insertions: 1, deletions: 2, undoable: true })

    const result = await host.rewind(record.id, 'm1', { conversation: true, code: true })
    expect(result).toEqual({ text: '二', filesRestored: 1, undoable: true })
    expect(readFileSync(file, 'utf8')).toBe('old')
    expect(userTexts(host, record.id)).toEqual(['一'])
    expect(host.open(record.id).record.pendingRewind).toBeTruthy()

    await host.undoRewind(record.id)
    expect(readFileSync(file, 'utf8')).toBe('new')
    expect(userTexts(host, record.id)).toEqual(['一', '二', '三'])
    expect(host.open(record.id).record.pendingRewind).toBeNull()
    // 撤销后接着聊，上下文是完整的
    await host.send(record.id, { text: '四', clientMessageId: 'm3' })
    await waitFor(() => turnsDone(record.id) === 4)
    expect(visible().at(-1)).toEqual(['一', '二', '三'])
    await expect(host.undoRewind(record.id)).rejects.toThrow('不能撤销')
  })

  it('只恢复代码：对话不动；还原时文件不存在，撤销时删掉', async () => {
    const file = join(root, 'b.txt')
    const host = makeHost({ FAKE_CLAUDE_REWIND: JSON.stringify({ file, content: 'restored' }) })
    const { record } = await conversation(host, ['一', '二'])
    const result = await host.rewind(record.id, 'm1', { conversation: false, code: true })
    expect(result).toEqual({ text: '', filesRestored: 1, undoable: true })
    expect(userTexts(host, record.id)).toEqual(['一', '二'])
    expect(readFileSync(file, 'utf8')).toBe('restored')
    await host.undoRewind(record.id)
    expect(existsSync(file)).toBe(false)
  })

  it('没有检查点：预览说明原因，要求恢复代码时报错且什么都不改', async () => {
    const host = makeHost()
    const { record } = await conversation(host, ['一', '二'])
    await expect(host.rewindPreview(record.id, 'm1')).resolves.toMatchObject({
      code: { ok: false, reason: 'no-checkpoint' },
    })
    await expect(host.rewind(record.id, 'm1', { conversation: true, code: true })).rejects.toThrow('检查点')
    expect(userTexts(host, record.id)).toEqual(['一', '二'])
  })

  it('截断点在上下文压缩之前：复制记录到截断点，换新的引擎会话接上，原记录不动（§2.4）', async () => {
    const host = makeHost()
    const { record, cwd } = await conversation(host, ['一', '二', '三'])
    const sid = host.open(record.id).record.engineSessionId!
    const source = compact(cwd, sid)
    const before = readFileSync(source, 'utf8')
    await host.rewind(record.id, 'm1')
    await host.send(record.id, { text: '改', clientMessageId: 'x' })
    await waitFor(() => turnsDone(record.id) === 4)
    expect(visible().at(-1)).toEqual(['一'])
    const after = host.open(record.id)
    expect(after.record.engineSessionId).not.toBe(sid)
    expect(after.record.pendingRewind).toBeNull()
    expect(after.items.some(i => i.kind === 'notice')).toBe(false)
    expect(readFileSync(source, 'utf8')).toBe(before)
  })

  it('回退后发了新消息就不能撤销', async () => {
    const host = makeHost()
    const { record } = await conversation(host, ['一', '二'])
    await host.rewind(record.id, 'm1')
    await host.send(record.id, { text: '改', clientMessageId: 'x' })
    await waitFor(() => turnsDone(record.id) === 3)
    await expect(host.undoRewind(record.id)).rejects.toThrow('不能撤销')
    expect(userTexts(host, record.id)).toEqual(['一', '改'])
  })
})

describe('分叉', () => {
  it('新会话带上这条消息之前的对话，引擎从截断点复制，原会话不变', async () => {
    const host = makeHost()
    const { record } = await conversation(host, ['一', '二', '三'])
    const forked = host.forkSession(record.id, 'm2')
    expect(forked.text).toBe('三')
    const title = host.open(record.id).record.title
    expect(forked.record).toMatchObject({ title: `${title}（分支）`, forkedFrom: { sessionId: record.id, title } })
    expect(forked.record.pendingFork?.from).toBe(host.open(record.id).record.engineSessionId)
    expect(userTexts(host, forked.record.id)).toEqual(['一', '二'])
    expect(userTexts(host, record.id)).toEqual(['一', '二', '三'])

    await host.send(forked.record.id, { text: '另一条路', clientMessageId: 'f1' })
    await waitFor(() => turnsDone(forked.record.id) === 1)
    const args = spawnArgs().at(-1)!
    expect(args).toContain('--fork-session')
    expect(args).toContain('--session-id')
    expect(visible().at(-1)).toEqual(['一', '二'])
    expect(host.open(forked.record.id).record.pendingFork).toBeNull()
    expect(userTexts(host, forked.record.id)).toEqual(['一', '二', '另一条路'])
  })

  it('截断点在上下文压缩之前：自己复制记录到截断点，用 --resume 接上（§2.4）', async () => {
    const host = makeHost()
    const { record, cwd } = await conversation(host, ['一', '二', '三'])
    const source = compact(cwd, host.open(record.id).record.engineSessionId!)
    const before = readFileSync(source, 'utf8')
    const forked = host.forkSession(record.id, 'm2')
    await host.send(forked.record.id, { text: '另一条路', clientMessageId: 'f1' })
    await waitFor(() => turnsDone(forked.record.id) === 1)
    const args = spawnArgs().at(-1)!
    expect(args).not.toContain('--fork-session')
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual([
      '--resume',
      forked.record.engineSessionId,
    ])
    expect(visible().at(-1)).toEqual(['一', '二'])
    expect(host.open(forked.record.id).record.pendingFork).toBeNull()
    expect(host.open(forked.record.id).items.some(i => i.kind === 'notice')).toBe(false)
    expect(readFileSync(source, 'utf8')).toBe(before)
  })

  it('分叉第一条消息：空的新会话，不带截断点', async () => {
    const host = makeHost()
    const { record } = await conversation(host, ['一'])
    const forked = host.forkSession(record.id, 'm0')
    expect(host.open(forked.record.id).items).toEqual([])
    expect(forked.record.pendingFork).toBeNull()
  })
})

describe('旁聊', () => {
  it('带着主对话的上下文，没有工具，不写记录、不进主对话', async () => {
    const host = makeHost()
    const { record } = await conversation(host, ['一', '二'])
    const before = host.open(record.id).items.length
    const answer = await host.sideQuestion(record.id, '这是什么', [{ question: '前一问', answer: '前一答' }])
    expect(answer).toBe('问：这是什么｜工具=[]｜看到=一,二')
    expect(host.open(record.id).items).toHaveLength(before)
    const args = spawnArgs().at(-1)!
    expect(args).toEqual(expect.arrayContaining(['--fork-session', '--no-session-persistence', '--tools', '']))
  })

  it('还没发过消息时不能用', async () => {
    const host = makeHost()
    const project = host.addProject(mkdtempSync(join(root, 'proj-')))
    const record = host.createSession({ projectId: project.id, permissionMode: 'ask' })
    await expect(host.sideQuestion(record.id, '问', [])).rejects.toThrow('先在主对话里发一条消息')
  })
})
