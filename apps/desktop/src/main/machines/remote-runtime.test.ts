import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL } from '@pixelsky/protocol'
import { createRemoteRuntime } from './remote-runtime'

// 远端辅助进程的方法表：用假的 RPC 对端直接调用，确认远端行为（docs/restructure.md §8.3 P6）
let root: string, project: string
let runtime: Awaited<ReturnType<typeof createRemoteRuntime>>
const events: [string, unknown][] = []

beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'remote-runtime-'))
  project = join(root, 'project')
  await mkdir(project)
  events.length = 0
  runtime = await createRemoteRuntime(
    {
      call: async () => {
        throw new Error('no desktop in tests')
      },
      event: (channel: string, value: unknown) => events.push([channel, value]),
    },
    join(root, 'data'),
  )
})
afterEach(async () => {
  await runtime.close()
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
})

const call = <T = any>(method: string, ...args: unknown[]): Promise<T> => runtime.call(method, args) as Promise<T>

describe('remote runtime', () => {
  it('answers the handshake and rejects unknown methods', async () => {
    const hello = await call('hello')
    expect(hello).toMatchObject({ protocol: REMOTE_PROTOCOL, node: process.versions.node })
    await expect(call('engine:nothing')).rejects.toThrow('REMOTE_UNSUPPORTED: engine:nothing')
    await expect(call('toString')).rejects.toThrow('REMOTE_UNSUPPORTED')
  })

  it('lists directories', async () => {
    await mkdir(join(project, 'b'))
    await mkdir(join(project, 'a'))
    await writeFile(join(project, 'file.txt'), '')
    const listing = await call('directories', project)
    expect(listing.directories).toEqual(['a', 'b'])
    expect(listing.parent).toBe(resolve(project, '..'))
  })

  it('manages projects and sessions', async () => {
    const added = await call('engine:addProject', project)
    expect(added).toMatchObject({ name: 'project', path: project })
    expect(await call('engine:addProject', project)).toEqual(added)
    await call('engine:renameProject', added.id, 'Renamed')
    expect((await call('engine:projects'))[0].name).toBe('Renamed')
    const session = await call('engine:createSession', { projectId: added.id })
    expect(session).toMatchObject({ projectId: added.id, cwd: project })
    await call('engine:renameSession', session.id, 'Hello')
    expect((await call('engine:sessions')).map((s: any) => s.record.title)).toEqual(['Hello'])
    await expect(call('engine:createSession', { projectId: added.id, workspaceSessionId: 'missing' })).rejects.toThrow(
      '工作区不属于项目',
    )
    await call('engine:deleteSession', session.id)
    expect(await call('engine:sessions')).toEqual([])
    await call('engine:removeProject', added.id)
    expect(await call('engine:projects')).toEqual([])
  })

  it('lists the project workspace and reads files', async () => {
    const added = await call('engine:addProject', project)
    // scratch 在仓库里，分支取决于外层仓库，不断言
    expect(await call('workspaces', added.id)).toMatchObject([
      { projectId: added.id, name: 'project', path: project, copyId: null, error: null },
    ])
    await writeFile(join(project, 'a.txt'), 'hello')
    const ref = { projectId: added.id }
    expect((await call('files:list', ref, '')).entries.map((e: any) => e.name)).toEqual(['a.txt'])
    const doc = await call('files:read', ref, 'a.txt')
    expect(doc).toMatchObject({ kind: 'text', content: 'hello' })
    await expect(call('files:read', ref, '../outside')).rejects.toThrow()
  })

  it('keeps manual tasks per project', async () => {
    const added = await call('engine:addProject', project)
    const task = await call('projectTools:createTask', added.id, { title: 'Write tests', note: 'remote' })
    await call('projectTools:updateTask', task.id, { status: 'in_progress' })
    const state = await call('projectTools:tasks', added.id)
    expect(state.tasks).toMatchObject([{ id: task.id, title: 'Write tests', status: 'in_progress' }])
    expect((await call('projectTools:searchTasks', 'write', null)).map((t: any) => t.id)).toEqual([task.id])
    await call('projectTools:deleteTask', task.id)
    expect((await call('projectTools:tasks', added.id)).tasks).toEqual([])
    expect(events.some(([channel]) => channel === 'projectTools:changed')).toBe(true)
  })

  it('only previews files recorded as AI changes', async () => {
    const added = await call('engine:addProject', project)
    const session = await call('engine:createSession', { projectId: added.id })
    await writeFile(join(project, 'a.txt'), 'hello')
    await expect(call('engine:artifactRead', { sessionId: session.id, path: join(project, 'a.txt') })).rejects.toThrow(
      '只能打开 AI 改动记录里的文件',
    )
  })

  it('discards untracked files of a git repository', async () => {
    execFileSync('git', ['init', '-q'], { cwd: project })
    await writeFile(join(project, 'new.txt'), 'draft')
    const added = await call('engine:addProject', project)
    const ref = { projectId: added.id }
    const status = await call('projectTools:gitStatus', ref)
    expect(status.untracked.map((f: any) => f.path)).toEqual(['new.txt'])
    await call('projectTools:gitDiscard', ref, { paths: [], untracked: ['new.txt'] })
    expect(existsSync(join(project, 'new.txt'))).toBe(false)
    expect(await readFile(join(project, '.git', 'HEAD'), 'utf8')).toMatch(/ref:/)
  })
})
