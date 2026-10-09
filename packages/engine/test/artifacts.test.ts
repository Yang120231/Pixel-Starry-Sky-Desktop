// 产物面板的数据（docs/ui/artifacts-panel.md §7）：不启动引擎，直接写会话记录
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deliveryType, type FileChange, type Item } from '@pixelsky/protocol'
import { EngineHost } from '../src/host'

let root: string, workspace: string, outside: string
let host: EngineHost
const DAY = 86_400_000
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-artifacts-'))
  workspace = join(root, 'project'); outside = join(root, 'outside')
  mkdirSync(workspace); mkdirSync(outside)
  host = new EngineHost({ dataDir: join(root, 'data'), emit: () => {}, adapters: {} })
  projectId = ''
})
afterEach(async () => { await host.shutdown(); rmSync(root, { recursive: true, force: true }) })

let projectId = ''
function record(title: string, items: Item[], patch: { cwd?: string; updatedAt?: number; archivedAt?: number } = {}) {
  if (!projectId) projectId = host.addProject(workspace).id
  const r = host.createSession({ projectId }, patch.cwd)
  const next = { ...r, title, cwd: patch.cwd ?? r.cwd, updatedAt: patch.updatedAt ?? Date.now(), archivedAt: patch.archivedAt ?? null }
  const dir = join(root, 'data', 'sessions', r.id)
  writeFileSync(join(dir, 'record.json'), JSON.stringify(next))
  writeFileSync(join(dir, 'items.jsonl'), items.map(i => JSON.stringify(i)).join('\n') + '\n')
  return next
}
async function reopen() { await host.shutdown(); host = new EngineHost({ dataDir: join(root, 'data'), emit: () => {}, adapters: {} }) }
const user = (id: string, text: string, createdAt = Date.now()): Item => ({ kind: 'user', id, text, createdAt })
const change = (path: string, kind: FileChange['kind'] = 'update', added = 1, removed = 0): FileChange => ({ path, kind, diff: '', added, removed })
const edit = (id: string, changes: FileChange[], status: 'completed' | 'failed' | 'declined' = 'completed'): Item => ({ kind: 'file_change', id, changes, status })
const query = (days = 7) => ({ requestId: 1, projectId, days })

describe('产物：变更', () => {
  it('按轮分组，同一轮按路径合并；失败 / 拒绝的改动不算；工作区外只计数', async () => {
    const r = record('改设置页', [
      user('u1', '把设置页迁到新表单\n第二行'),
      edit('e1', [change('src/a.ts', 'update', 3, 1)]),
      edit('e2', [change('src/a.ts', 'update', 2, 2), change('src/b.ts', 'add', 10)]),
      edit('e3', [change('src/c.ts')], 'declined'),
      edit('e4', [change(join(outside, 'notes.txt'), 'add', 4)]),
      user('u2', '再删一个'),
      edit('e5', [change('src/old.ts', 'delete', 0, 9)]),
    ])
    await reopen()
    const res = await host.artifacts(query(), workspace)
    expect(res.turns.map(t => [t.userItemId, t.prompt, t.files.map(f => [f.local, f.kind, f.added, f.removed, f.itemId])])).toEqual(expect.arrayContaining([
      ['u1', '把设置页迁到新表单 第二行', [['src/a.ts', 'update', 5, 3, 'e2'], ['src/b.ts', 'add', 10, 0, 'e2']]],
      ['u2', '再删一个', [['src/old.ts', 'delete', 0, 9, 'e5']]],
    ]))
    expect(res.turns[0].sessionId).toBe(r.id)
    expect(res.outsideCount).toBe(1)
    expect((host as unknown as { runtimes: Map<string, unknown> }).runtimes.size).toBe(0)
  })
  it('只看最近几天；同一条目以最后一版为准；只看这个工作区（副本目录的会话不算）', async () => {
    const old = Date.now() - 10 * DAY
    record('旧的', [user('u0', '很久以前', old), edit('e0', [change('a.ts')])], { updatedAt: old })
    const copy = join(root, 'copy'); mkdirSync(copy)
    record('副本里的', [user('uc', '副本'), edit('ec', [change('x.ts')])], { cwd: copy })
    const r = record('最近', [user('u1', '最近'), edit('e1', [change('a.ts')], 'failed')])
    appendFileSync(join(root, 'data', 'sessions', r.id, 'items.jsonl'), JSON.stringify(edit('e1', [change('a.ts', 'update', 7)])) + '\n')
    await reopen()
    const res = await host.artifacts(query(7), workspace)
    expect(res.turns.map(t => t.title)).toEqual(['最近'])
    expect(res.turns[0].files[0]).toMatchObject({ added: 7, local: 'a.ts' })
    expect((await host.artifacts(query(30), workspace)).turns.map(t => t.title).sort()).toEqual(['旧的', '最近'])
  })
})

describe('产物：交付', () => {
  it('新建的文档类文件和工作区外的文件算交付；源码、删除后的文件不算；按路径保留最新一次', async () => {
    writeFileSync(join(workspace, 'report.md'), '# 报告')
    writeFileSync(join(outside, 'data.csv'), 'a,b')
    record('交付', [
      user('u1', '写报告', Date.now() - 2000),
      edit('e1', [change('report.md', 'add'), change('src/new.ts', 'add'), change('chart.png', 'add'), change(join(outside, 'data.csv'), 'add')]),
      user('u2', '删掉图', Date.now() - 1000),
      edit('e2', [change('chart.png', 'delete')]),
      edit('e3', [change('report.md', 'update')]),
    ])
    await reopen()
    const res = await host.artifacts(query(), workspace)
    expect(res.delivered.map(d => [d.path.split(/[\\/]/).pop(), d.type, d.inside, d.exists])).toEqual(expect.arrayContaining([
      ['report.md', 'document', true, true],
      ['data.csv', 'table', false, true],
    ]))
    expect(res.delivered).toHaveLength(2)
    expect(res.delivered.find(d => d.type === 'table')?.bytes).toBe(3)
  })
  it('读取 / 打开前的安全检查：只有改动记录里出现过的路径', async () => {
    const r = record('检查', [user('u', 'x'), edit('e', [change(join(outside, 'ok.txt'), 'add')]), edit('f', [change(join(outside, 'no.txt'), 'add')], 'declined')])
    await reopen()
    expect(await host.recordedPath(r.id, join(outside, 'ok.txt'))).toBe(true)
    expect(await host.recordedPath(r.id, join(outside, 'no.txt'))).toBe(false)
    expect(await host.recordedPath(r.id, join(outside, '..', 'secret.txt'))).toBe(false)
    expect((await host.artifactItem(r.id, 'e'))?.changes[0].kind).toBe('add')
    expect(await host.artifactItem(r.id, 'u')).toBeNull()
  })
  it('中止时抛出', async () => {
    record('x', [user('u', 'x'), edit('e', [change('a.ts')])])
    const controller = new AbortController(); controller.abort()
    await expect(host.artifacts(query(), workspace, controller.signal)).rejects.toThrow()
  })
  it('交付类型按扩展名判断', () => {
    expect(['a.MD', 'b.pdf', 'c.png', 'd.xlsx', 'e.html', 'f.zip', 'g.mp4', 'h.ts', 'Makefile', '.env'].map(deliveryType)).toEqual(['document', 'document', 'image', 'table', 'web', 'archive', 'media', null, null, null])
  })
})
