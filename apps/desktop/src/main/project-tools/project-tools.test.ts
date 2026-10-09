import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Tasks } from './tasks'
import { Copies } from './copies'
import { Services, redact, childEnvironment, portStatus } from './services'
import { directory, git, JsonStore, type ToolsHost } from './common'
let root: string, project: string, host: ToolsHost
const managers: Services[] = []
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'tools-unit-'))
  project = join(root, 'project')
  await mkdir(project)
  host = {
    resolve(ref) {
      if (ref.projectId !== 'p') throw new Error('unknown')
      return { projectId: 'p', name: 'test', path: project }
    },
    plans: () => [],
    sessions: () => [],
    create: (id, cwd) => ({ id: 's', projectId: id, cwd }) as ReturnType<ToolsHost['create']>,
    withStopped: async (_path, action) => action(),
  }
})
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map(m => m.shutdown()))
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
})
describe('project tools storage and task operations', () => {
  it('serializes task writes, editing/reorder persist and unknown projects are rejected', async () => {
    const tasks = new Tasks(root, host, () => {})
    await tasks.init()
    const [a, b] = await Promise.all([tasks.create('p', { title: 'A' }), tasks.create('p', { title: 'B' })])
    await tasks.update(a.id, { status: 'in_progress', note: 'note', due: '2026-10-09', tags: ['tag'] })
    await tasks.reorder('p', [b.id, a.id])
    const restored = new Tasks(root, host, () => {})
    await restored.init()
    expect(restored.state('p').tasks.map(t => t.id)).toEqual([b.id, a.id])
    expect(restored.state('p').tasks[1]).toMatchObject({ status: 'in_progress', tags: ['tag'] })
    await expect(tasks.create('not-p', { title: 'bad' })).rejects.toThrow('unknown')
    await expect(tasks.reorder('p', [a.id, a.id])).rejects.toThrow()
  })
  it('failed snapshots restore state and keep live object references', async () => {
    const store = new JsonStore(join(root, 'data.json'), { tasks: [{ id: 'a', title: 'before' }] })
    await store.init()
    const ref = store.data.tasks[0]
    await expect(
      store.transaction(() => {
        ref.title = 'bad'
        throw Error('fail')
      }),
    ).rejects.toThrow()
    expect(store.data.tasks[0]).toBe(ref)
    expect(ref.title).toBe('before')
  })
  it('resolves real directories and blocks a junction outside the project', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(project, 'link'), 'junction')
    await expect(directory(project, '../outside')).rejects.toThrow()
    await expect(directory(project, 'link')).rejects.toThrow()
    expect(await directory(project, '')).toBe(project)
  })
})
describe('real git worktrees', () => {
  async function setup() {
    await git(project, ['init', '-b', 'main'])
    await git(project, ['config', 'user.email', 'tools@example.invalid'])
    await git(project, ['config', 'user.name', 'Tools test'])
    await writeFile(join(project, 'tracked.txt'), 'base')
    await git(project, ['add', '.'])
    await git(project, ['commit', '-m', 'fixture'])
    const copies = new Copies(
      root,
      host,
      () => {},
      async () => {},
    )
    await copies.init()
    return copies
  }
  it('creates isolated worktree, binds session cwd, detects dirty state and protects deletion', async () => {
    const copies = await setup()
    const input = {
      name: 'copy',
      branch: 'pixelsky/copy',
      existingBranch: false,
      base: 'HEAD',
      directory: join(root, 'copy'),
    }
    const preview = await copies.preview('p', input)
    expect(preview.commit).toMatch(/^[a-f0-9]{40}$/)
    const copy = await copies.create('p', input)
    expect(await readFile(join(copy.path, 'tracked.txt'), 'utf8')).toBe('base')
    expect((await copies.open(copy.id)).cwd).toBe(copy.path)
    await writeFile(join(copy.path, 'tracked.txt'), 'changed')
    expect((await copies.list('p'))[0].dirty).toBe(true)
    expect(await readFile(join(project, 'tracked.txt'), 'utf8')).toBe('base')
    await expect(copies.remove(copy.id)).rejects.toThrow('未提交')
    await copies.remove(copy.id, true)
    expect(await copies.list('p')).toEqual([])
    expect(await readFile(join(project, 'tracked.txt'), 'utf8')).toBe('base')
  })
  it('rejects Git option injection and existing destination without overwriting it', async () => {
    const copies = await setup(),
      path = join(root, 'existing')
    await mkdir(path)
    await writeFile(join(path, 'keep'), 'safe')
    await expect(
      copies.create('p', { name: 'bad', branch: '--force', existingBranch: false, base: 'HEAD' }),
    ).rejects.toThrow()
    await expect(
      copies.create('p', { name: 'bad', branch: 'new', existingBranch: false, base: 'HEAD', directory: path }),
    ).rejects.toThrow('已经存在')
    expect(await readFile(join(path, 'keep'), 'utf8')).toBe('safe')
  })
})
describe('local services', () => {
  it('detects occupied ports, suggests a free port and validates env names', async () => {
    const server = createServer()
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    try {
      const status = await portStatus(port)
      expect(status.occupied).toBe(true)
      expect(status.suggested).not.toBe(port)
    } finally {
      await new Promise<void>(r => server.close(() => r()))
    }
    expect(() => childEnvironment(['NODE_OPTIONS'], null)).toThrow()
    expect(redact('Bearer abcdsecret password=private secret-value', ['secret-value'])).not.toContain('secret-value')
  })
  it('persists definitions, runs a real process, reports exit and excludes secrets', async () => {
    const services = new Services(root, host, () => {})
    managers.push(services)
    await services.init()
    await writeFile(join(project, 'service.cjs'), "console.log('service-ready');setTimeout(()=>process.exit(0),200)")
    const service = await services.save({ projectId: 'p' }, { name: 'test', command: 'node service.cjs' })
    const started = await services.start(service.id)
    expect(started.status).toBe('running')
    const until = Date.now() + 6000
    while (services.get(service.id).status === 'running' && Date.now() < until)
      await new Promise(r => setTimeout(r, 50))
    expect(services.get(service.id)).toMatchObject({ status: 'stopped', exitCode: 0, pid: null })
    expect(services.get(service.id).output).toContain('service-ready')
    await expect(services.save({ projectId: 'p' }, { name: 'escape', command: 'node', cwd: '..' })).rejects.toThrow()
    const restored = new Services(root, host, () => {})
    managers.push(restored)
    await restored.init()
    expect(restored.list({ projectId: 'p' })[0]).toMatchObject({ name: 'test', status: 'stopped' })
  })
})
