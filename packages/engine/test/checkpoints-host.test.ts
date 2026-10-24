// 对话检查点接进宿主（docs/ui/undo-changes.md）：每轮前后拍快照、改动卡片撤回 / 恢复、回退只还原部分文件
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineInfo, ImageAttachment, SessionSettings } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import { CHECKPOINT_EXPIRED, CheckpointError } from '../src/checkpoints'
import { EngineHost } from '../src/host'
import { ENGINES } from '../src/registry'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
let work: string
let hosts: EngineHost[]

beforeEach(() => {
  root = makeTmp('checkpoints-host')
  work = join(root, 'work')
  mkdirSync(work)
  hosts = []
})
afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  removeTmp(root)
})

const until = async (fn: () => boolean, what = 'condition'): Promise<void> => {
  for (let i = 0; i < 1000; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`timeout: ${what}`)
}

const read = (path: string): string | null =>
  existsSync(join(work, path)) ? readFileSync(join(work, path), 'utf8') : null
const write = (path: string, text: string): void => writeFileSync(join(work, path), text)

/** 每条消息按 edits 表改文件，然后结束这一轮 */
class EditingSession implements EngineSession {
  constructor(
    readonly ctx: SessionContext,
    private readonly edits: Record<string, Record<string, string>>,
  ) {}
  send(text: string, turnId: string, _id: string, _attachments?: ImageAttachment[]) {
    for (const [path, content] of Object.entries(this.edits[text] ?? {})) write(path, content)
    setTimeout(() => this.ctx.emit({ type: 'turn_completed', turnId, outcome: 'completed', error: null }), 5)
  }
  async interrupt() {}
  answer() {}
  async update(_patch: Partial<SessionSettings>) {}
  async close() {}
}

class EditingAdapter implements EngineAdapter {
  constructor(private readonly edits: Record<string, Record<string, string>>) {}
  async info(): Promise<EngineInfo> {
    return { ...ENGINES.claude, status: 'ready', version: 'fake', path: 'fake', message: null }
  }
  createSession(ctx: SessionContext) {
    return new EditingSession(ctx, this.edits)
  }
  async update() {
    return { ok: true, output: '', version: null }
  }
}

function setup(edits: Record<string, Record<string, string>>) {
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    adapters: { claude: new EditingAdapter(edits) },
    checkpoints: true,
    emit: () => {},
  })
  hosts.push(host)
  const project = host.addProject(work)
  const id = host.createSession({ projectId: project.id }).id
  const send = async (text: string): Promise<string> => {
    await host.send(id, { text, clientMessageId: text })
    // 等这一轮结束、结束时的快照也拍完（files 有值）
    await until(() => {
      const snap = host.open(id)
      const user = snap.items.find(i => i.kind === 'user' && i.text === text)
      return (
        snap.state === 'idle' &&
        !!user &&
        host.checkpoints(id).turns.some(t => t.itemId === user.id && t.files !== null)
      )
    }, `turn ${text}`)
    return host.open(id).items.find(i => i.kind === 'user' && i.text === text)!.id
  }
  return { host, id, send }
}

describe('对话检查点（宿主）', () => {
  it('每轮记下改了哪些文件；改动卡片撤回新建的文件、再恢复', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'a.txt': 'new\n', 'keep.txt': 'v1\n' } })
    const a = await send('a')
    expect(host.checkpoints(id).turns).toEqual([{ itemId: a, files: ['a.txt', 'keep.txt'], at: expect.any(Number) }])

    const result = await host.revertFiles(id, a, [join(work, 'a.txt')], false)
    expect(result).toMatchObject({ kind: 'done', reverted: [join(work, 'a.txt')], skipped: [] })
    expect(read('a.txt')).toBeNull()
    const revertId = result.kind === 'done' ? result.revertId! : ''
    expect(host.checkpoints(id).reverted).toEqual([{ revertId, itemId: a, paths: [join(work, 'a.txt')] }])

    await host.restoreFiles(id, revertId)
    expect(read('a.txt')).toBe('new\n')
    expect(host.checkpoints(id).reverted).toEqual([])
  })

  it('之后又被改过：先返回冲突，确认后才撤回', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'keep.txt': 'v1\n' }, b: { 'keep.txt': 'v2\n' } })
    const a = await send('a')
    await send('b')
    const conflict = await host.revertFiles(id, a, ['keep.txt'], false)
    expect(conflict).toMatchObject({ kind: 'conflict', conflicts: [{ path: 'keep.txt', added: 1, removed: 1 }] })
    expect(conflict.kind === 'conflict' && conflict.conflicts[0].diff).toContain('+v2')
    expect(read('keep.txt')).toBe('v2\n')

    const done = await host.revertFiles(id, a, ['keep.txt'], true)
    expect(done.kind).toBe('done')
    expect(read('keep.txt')).toBe('v0\n')
  })

  it('工作目录外、被排除的文件不能撤回', async () => {
    write('.gitignore', 'secret.env\n')
    const { host, id, send } = setup({ a: { 'secret.env': 'k\n', 'ok.txt': 'ok\n' } })
    const a = await send('a')
    const result = await host.revertFiles(id, a, ['secret.env', join(root, 'outside.txt'), 'ok.txt'], false)
    expect(result).toMatchObject({
      kind: 'done',
      reverted: ['ok.txt'],
      skipped: [
        { path: join(root, 'outside.txt'), reason: 'outside' },
        { path: 'secret.env', reason: 'excluded' },
      ],
    })
    expect(read('secret.env')).toBe('k\n')
  })

  it('回退：预览列出手改过的文件，只还原选中的几个，可以撤销', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'a.txt': 'a\n', 'keep.txt': 'v1\n' }, b: { 'b.txt': 'b\n' } })
    const a = await send('a')
    await send('b')
    write('keep.txt', 'hand\n')
    const preview = await host.rewindPreview(id, a)
    expect(preview.code).toMatchObject({
      ok: true,
      files: ['a.txt', 'b.txt', 'keep.txt'],
      edited: ['keep.txt'],
      checkpoint: true,
    })

    const result = await host.rewind(id, a, { conversation: false, code: true, paths: ['a.txt', 'keep.txt'] })
    expect(result.filesRestored).toBe(2)
    expect(read('a.txt')).toBeNull()
    expect(read('keep.txt')).toBe('v0\n')
    expect(read('b.txt')).toBe('b\n')

    await host.undoRewind(id)
    expect(read('a.txt')).toBe('a\n')
    expect(read('keep.txt')).toBe('hand\n')
  })

  it('回退对话后，被移除的轮次不再当成「最后一轮」：不会把它改过的文件误报成手改', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'keep.txt': 'v1\n' }, b: { 'keep.txt': 'v2\n' } })
    const a = await send('a')
    const b = await send('b')
    await host.rewind(id, b, { conversation: true, code: true })
    expect(read('keep.txt')).toBe('v1\n')
    const preview = await host.rewindPreview(id, a)
    expect(preview.code).toMatchObject({ ok: true, files: ['keep.txt'], edited: [] })
    // 撤回 a 也不该报冲突：现在的内容就是 a 结束时的
    expect(await host.revertFiles(id, a, ['keep.txt'], false)).toMatchObject({ kind: 'done', reverted: ['keep.txt'] })
    expect(read('keep.txt')).toBe('v0\n')
  })

  it('开始打字时先在后台拍第一次（只建仓库，不记成哪一轮的快照）', async () => {
    write('a.txt', 'a\n')
    const { host, id } = setup({})
    const head = join(root, 'data', 'sessions', id, 'checkpoints', 'HEAD')
    expect(existsSync(head)).toBe(false)
    host.prepareCheckpoints(id)
    await until(() => existsSync(join(root, 'data', 'sessions', id, 'checkpoints', 'index')), 'prepared index')
    expect(host.checkpoints(id).turns).toEqual([])
  })

  it('连续超时停用后只是不再拍新的：已有的快照照样能撤回', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'keep.txt': 'v1\n' } })
    const a = await send('a')
    const checkpoints = (host as unknown as { m: { checkpoints: { failed(id: string, err: Error): void } } }).m
      .checkpoints
    for (let i = 0; i < 3; i++) checkpoints.failed(id, new CheckpointError('timeout', '拍快照超时'))
    expect(host.checkpoints(id)).toMatchObject({ disabled: 'slow', turns: [{ itemId: a }] })
    expect(await host.revertFiles(id, a, ['keep.txt'], false)).toMatchObject({ kind: 'done', reverted: ['keep.txt'] })
    expect(read('keep.txt')).toBe('v0\n')
  })

  it('一轮刚结束就删会话：结束后台的 git，会话目录删干净', async () => {
    const { host, id } = setup({ a: { 'a.txt': 'a\n' } })
    await host.send(id, { text: 'a', clientMessageId: 'a' })
    await until(() => host.open(id).state === 'idle' && host.open(id).items.length > 0, 'turn a')
    await host.deleteSession(id)
    expect(existsSync(join(root, 'data', 'sessions', id))).toBe(false)
  })

  it('旧记录里存下的「太慢」不再永久停用', async () => {
    write('a.txt', 'a\n')
    const { host, id, send } = setup({ a: { 'a.txt': 'b\n' } })
    const dir = join(root, 'data', 'sessions', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'checkpoints.json'),
      JSON.stringify({ version: 1, cwd: work, disabled: 'slow', message: '拍快照超时', turns: {} }),
    )
    const a = await send('a')
    expect(host.checkpoints(id)).toMatchObject({ disabled: null, turns: [{ itemId: a, files: ['a.txt'] }] })
  })

  it('快照缺了内容（影子仓库被删过）：预览说快照失效、不再列出，回退代码报失效、不动文件', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'keep.txt': 'v1\n' }, b: { 'keep.txt': 'v2\n' } })
    const a = await send('a')
    const b = await send('b')
    rmSync(join(root, 'data', 'sessions', id, 'checkpoints'), { recursive: true })
    expect((await host.rewindPreview(id, a)).code).toEqual({
      ok: false,
      reason: 'expired',
      message: CHECKPOINT_EXPIRED,
    })
    expect(host.checkpoints(id).turns.map(t => t.itemId)).toEqual([b])
    await expect(host.rewind(id, a, { conversation: false, code: true })).rejects.toThrow(CHECKPOINT_EXPIRED)
    expect(read('keep.txt')).toBe('v2\n')
    // 同时回退对话：对话照样回退，告诉界面代码为什么没恢复
    const result = await host.rewind(id, a, { conversation: true, code: true })
    expect(result.codeSkipped).toBe(CHECKPOINT_EXPIRED)
    expect(read('keep.txt')).toBe('v2\n')
  })

  it('改动卡片撤回时才发现快照失效：跳过并说明，记为失效', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'keep.txt': 'v1\n' } })
    const a = await send('a')
    rmSync(join(root, 'data', 'sessions', id, 'checkpoints'), { recursive: true })
    expect(await host.revertFiles(id, a, ['keep.txt'], false)).toEqual({
      kind: 'done',
      revertId: null,
      reverted: [],
      skipped: [{ path: 'keep.txt', reason: 'no-checkpoint', message: CHECKPOINT_EXPIRED }],
    })
    expect(read('keep.txt')).toBe('v1\n')
    expect(host.checkpoints(id).turns).toEqual([])
    const saved = JSON.parse(readFileSync(join(root, 'data', 'sessions', id, 'checkpoints.json'), 'utf8'))
    expect(saved.turns[a].lost).toBe(true)
  })

  it('后一轮失效了：它结束时的快照照样用来判断手改，它改的文件不误报成手改', async () => {
    write('keep.txt', 'v0\n')
    const { host, id, send } = setup({ a: { 'keep.txt': 'v1\n' }, b: { 'keep.txt': 'v2\n' } })
    const a = await send('a')
    const b = await send('b')
    const states = (
      host as unknown as {
        m: { checkpoints: { states: Map<string, { data: { turns: Record<string, { lost?: true }> } }> } }
      }
    ).m.checkpoints.states
    states.get(id)!.data.turns[b]!.lost = true
    expect((await host.rewindPreview(id, a)).code).toMatchObject({ ok: true, files: ['keep.txt'], edited: [] })
    expect(await host.revertFiles(id, a, ['keep.txt'], false)).toMatchObject({ kind: 'conflict' })
  })

  it('没打开检查点时不拍快照', async () => {
    const host = new EngineHost({
      dataDir: join(root, 'data'),
      adapters: { claude: new EditingAdapter({ a: { 'a.txt': 'a\n' } }) },
      emit: () => {},
    })
    hosts.push(host)
    const id = host.createSession({ projectId: host.addProject(work).id }).id
    await host.send(id, { text: 'a', clientMessageId: 'a' })
    await until(() => host.open(id).state === 'idle' && host.open(id).items.length > 0)
    expect(host.checkpoints(id)).toEqual({ disabled: null, turns: [], reverted: [] })
    expect(existsSync(join(root, 'data', 'sessions', id, 'checkpoints'))).toBe(false)
  })
})
