import { homedir, hostname, platform, arch } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { REMOTE_PROTOCOL, type IPC_CONTRACT, type SessionRecord } from '@pixelsky/protocol'
import { EngineHost, type EngineHostOptions } from '@pixelsky/engine'
import { WorkspaceFiles, workspaceRef } from '../core/workspace-files'
import { Tasks } from '../core/project-tools/tasks'
import { Services, portStatus } from '../core/project-tools/services'
import { Copies } from '../core/project-tools/copies'
import { GitTools } from '../core/project-tools/git'
import { readArtifact } from '../core/artifact-files'
import { gitInfo, samePath, value, type ToolsHost } from '../core/project-tools/common'
import type { CopyInput, ManualTask, ServiceInput } from '../../shared/types/project-tools'
import type { WorkspaceRef } from '../../shared/types/workspace'
import type { RpcPeer } from './rpc'

type Handler = (...args: any[]) => unknown
type RemoteOf<Spec> = Spec extends { readonly remote: infer Method extends string } ? Method : never
/** Every method name the IPC contract declares in a `remote` field: each one needs an implementation below. */
type ContractMethod = RemoteOf<(typeof IPC_CONTRACT)[keyof typeof IPC_CONTRACT]>
/** Methods that serve no channel: the handshake, and the platform requests the helper sends back to the desktop. */
type HelperMethod = 'hello' | 'platform:request' | 'platform:record'

export async function createRemoteRuntime(
  peer: Pick<RpcPeer, 'call' | 'event'>,
  dataDir = join(homedir(), '.local', 'share', 'pixelsky', 'remote', 'data'),
  extra: Partial<EngineHostOptions> = {},
) {
  const environments = new Map<string, NodeJS.ProcessEnv>()
  const prepare = async (record: SessionRecord) => {
    if (!record.platform) {
      environments.delete(record.id)
      return
    }
    const env = await peer.call<NodeJS.ProcessEnv>('platform:environment', [record])
    if (record.engine === 'claude') {
      const file = join(dataDir, 'gateway', record.id + '.json')
      delete env.PIXELSKY_GATEWAY_SETTINGS
      await mkdir(dirname(file), { recursive: true, mode: 0o700 })
      await writeFile(file, JSON.stringify({ env }), { mode: 0o600 })
      env.PIXELSKY_GATEWAY_SETTINGS = file
    }
    environments.set(record.id, env)
  }
  const host = new EngineHost({
    ...extra,
    dataDir: join(dataDir, 'engine'),
    emit: event => peer.event('engine:event', event),
    sessionEnv: record => environments.get(record.id) ?? {},
    validateInput: prepare,
    platformCharges: (settlement, _signal) => peer.call('platform:charges', [settlement]),
  })
  const resolve = (ref: WorkspaceRef) => {
    const record = ref.sessionId ? host.record(ref.sessionId) : null
    const project = host.projects().find(p => p.id === (record?.projectId ?? ref.projectId))
    if (!project && !record) throw new Error('项目已不存在')
    return { ref, name: project?.name ?? record!.title, path: record?.cwd ?? project!.path }
  }
  const tools: ToolsHost = {
    resolve(ref) {
      const target = resolve(ref)
      const projectId = ref.projectId ?? host.record(ref.sessionId!)?.projectId
      if (!projectId) throw new Error('项目已不存在')
      return { ...target, projectId }
    },
    sessions(path) {
      return host
        .sessions()
        .filter(s => samePath(s.record.cwd, path))
        .map(s => ({ id: s.record.id, title: s.record.title, state: s.state }))
    },
    plans(projectId) {
      return host
        .sessions()
        .filter(s => s.record.projectId === projectId)
        .flatMap(s => {
          const item = host
            .open(s.record.id)
            .items.filter((i): i is Extract<import('@pixelsky/protocol').Item, { kind: 'todo' }> => i.kind === 'todo')
            .at(-1)
          return item ? [{ sessionId: s.record.id, title: s.record.title, item }] : []
        })
    },
    create: (projectId, cwd) => host.createSession({ projectId }, cwd),
    withStopped: (path, action) => host.withWorkspaceStopped(path, action),
  }
  const changed = () => peer.event('projectTools:changed', null)
  const files = new WorkspaceFiles(resolve),
    tasks = new Tasks(join(dataDir, 'tools'), tools, changed)
  let copies!: Copies
  const services = new Services(join(dataDir, 'tools'), tools, changed, (id, path) => copies.verifyPath(id, path))
  copies = new Copies(join(dataDir, 'tools'), tools, changed, path => services.stopPath(path))
  // Git 面板：远端没有回收站，放弃未跟踪文件用 git clean（docs/ui/git-panel.md §2.4）
  const git = new GitTools(tools, changed)
  await Promise.all([tasks.init(), copies.init()])
  await services.init()
  const contractMethods: Record<ContractMethod, Handler> = {
    directories: async (input?: string) => {
      const path = await realpath(input ? value(input, 4096, true) : homedir())
      if (!isAbsolute(path)) throw new Error('目录不正确')
      const directories = (await readdir(path, { withFileTypes: true }))
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .slice(0, 2000)
      return { path, parent: dirname(path) === path ? null : dirname(path), directories }
    },
    'engine:projects': () => host.projects(),
    'engine:addProject': path => host.addProject(value(path, 4096, true)),
    'engine:removeProject': id => host.removeProject(id),
    'engine:renameProject': (id, name) => host.renameProject(id, name),
    'engine:sessions': () => host.sessions(),
    'engine:engines': force => host.engines(force === true),
    'engine:defaults': () => host.defaults(),
    'engine:config': () => host.engineConfig(),
    'engine:setConfig': (engine, patch) => host.setEngineConfig(engine, patch),
    'engine:setDefaultEngine': engine => host.setDefaultEngine(engine),
    'engine:catalog': (engine, force) => host.engineCatalog(engine, force === true),
    'engine:update': engine => host.updateEngine(engine),
    'engine:retrySettings': () => host.retrySettings(),
    'engine:setRetrySettings': value => host.setRetrySettings(value),
    'engine:createSession': async opts => {
      let cwd: string | undefined
      if (opts.workspaceSessionId) {
        const origin = host.record(opts.workspaceSessionId)
        if (!origin || origin.projectId !== opts.projectId) throw new Error('工作区不属于项目')
        cwd = origin.cwd
      }
      if (opts.copyId) {
        const copy = copies.get(opts.copyId)
        if (copy.projectId !== opts.projectId) throw new Error('副本不属于项目')
        await copies.verify(copy)
        cwd = copy.path
      }
      return host.createSession(opts, cwd)
    },
    'engine:openSession': id => host.openSession(id),
    'engine:send': (id, input) => host.send(id, input),
    'engine:context': id => host.inspectContext(id),
    'engine:compact': id => host.compactContext(id),
    'engine:updateSession': async (id, patch) => {
      const record = host.record(id)
      if (record) await prepare({ ...record, ...patch })
      return host.update(id, patch)
    },
    'engine:cancelQueued': (id, queue) => host.cancelQueued(id, queue),
    'engine:moveQueued': (id, queue, to) => host.moveQueued(id, queue, to),
    'engine:runQueuedNow': (id, queue) => host.runQueuedNow(id, queue),
    'engine:steerQueued': (id, queue, turn) => host.steerQueued(id, queue, turn),
    'engine:resumeQueue': id => host.resumeQueue(id),
    'engine:rewind': (id, item) => host.rewind(id, item),
    'engine:interrupt': id => host.interrupt(id),
    'engine:interruptTurn': (id, turn) => host.interruptTurn(id, turn),
    'engine:answer': (id, request, decision) => host.answer(id, request, decision),
    'engine:deleteSession': id => host.deleteSession(id),
    'engine:renameSession': (id, title) => host.renameSession(id, title),
    'engine:setSessionBottom': (id, bottomed) => host.setSessionBottom(id, bottomed),
    'engine:archiveSession': (id, archived, stop) => host.archiveSession(id, archived, stop),
    'engine:stopTask': (id, task) => host.stopTask(id, task),
    'engine:taskOutput': (id, task) => host.taskOutput(id, task),
    'engine:subagentTranscript': (id, agent) => host.subagentTranscript(id, agent),
    'engine:search': query => host.search(query),
    'engine:cancelSearch': () => {},
    'engine:usageSummary': q => host.usageSummary(q),
    'engine:usageList': q => host.usageList(q),
    'engine:usageClear': () => host.usageClear(),
    'engine:usageExport': q => host.usageCsv(q),
    'files:target': ref => files.target(ref),
    'files:list': (ref, path) => files.list(workspaceRef(ref), path),
    'files:search': (ref, name) => files.search(workspaceRef(ref), name),
    'files:status': ref => files.status(workspaceRef(ref)),
    'files:read': (ref, path) => files.read(workspaceRef(ref), path),
    'files:save': (ref, path, text, version) => files.save(workspaceRef(ref), path, text, version),
    'files:headContent': (ref, path) => files.headContent(workspaceRef(ref), path),
    'projectTools:tasks': id => tasks.state(id),
    'projectTools:createTask': (id, input: Partial<ManualTask>) => tasks.create(id, input),
    'projectTools:updateTask': (id, input) => tasks.update(id, input),
    'projectTools:deleteTask': id => tasks.remove(id),
    'projectTools:reorderTasks': (id, ids) => tasks.reorder(id, ids),
    'projectTools:searchTasks': (text: string, id: string | null) =>
      tasks.store.data.tasks
        .filter(
          t =>
            (!id || t.projectId === id) &&
            (t.title + '\n' + t.note).toLocaleLowerCase().includes(value(text, 200).toLocaleLowerCase()),
        )
        .slice(0, 20),
    'projectTools:environment': (ref, force) => services.environment(ref, force),
    'projectTools:services': ref => services.list(ref),
    'projectTools:saveService': (ref, input: ServiceInput) => services.save(ref, input),
    'projectTools:deleteService': id => services.remove(id),
    'projectTools:startService': id => services.start(id),
    'projectTools:stopService': (id, force) => services.stop(id, force),
    'projectTools:restartService': id => services.restart(id),
    'projectTools:portStatus': port => portStatus(port),
    'projectTools:copies': id => copies.list(id),
    'projectTools:branches': id => copies.branches(id),
    'projectTools:previewCopy': (id, input: CopyInput) => copies.preview(id, input),
    'projectTools:createCopy': (id, input: CopyInput) => copies.create(id, input),
    // 产物面板（docs/ui/artifacts-panel.md）：远端只能预览，打开 / 显示文件夹只在本机
    'engine:artifacts': (input: { requestId: number; sessionId?: string; projectId?: string; days: number }) => {
      const target = tools.resolve(
        workspaceRef(input?.sessionId ? { sessionId: input.sessionId } : { projectId: input?.projectId }),
      )
      return host.artifacts({ requestId: input.requestId, projectId: target.projectId, days: input.days }, target.path)
    },
    'engine:artifactChange': (input: { sessionId: string; itemId: string }) =>
      host.artifactItem(value(input?.sessionId, 200, true), value(input?.itemId, 200, true)),
    'engine:artifactRead': async (input: { sessionId: string; path: string }) => {
      const path = value(input?.path, 4096, true)
      if (!isAbsolute(path) || !(await host.recordedPath(value(input?.sessionId, 200, true), path)))
        throw new Error('只能打开 AI 改动记录里的文件')
      return readArtifact(path)
    },
    'projectTools:gitStatus': ref => git.status(workspaceRef(ref)),
    'projectTools:gitDiff': (ref, input) => git.diff(workspaceRef(ref), input),
    'projectTools:gitBranches': ref => git.branches(workspaceRef(ref)),
    'projectTools:gitStage': (ref, paths) => git.stage(workspaceRef(ref), paths),
    'projectTools:gitUnstage': (ref, paths) => git.unstage(workspaceRef(ref), paths),
    'projectTools:gitDiscard': (ref, input) => git.discard(workspaceRef(ref), input),
    'projectTools:gitCommit': (ref, input) => git.commit(workspaceRef(ref), input),
    'projectTools:gitPull': (ref, mode) => git.pull(workspaceRef(ref), mode),
    'projectTools:gitPush': (ref, input) => git.push(workspaceRef(ref), input),
    'projectTools:gitFetch': ref => git.fetch(workspaceRef(ref)),
    'projectTools:gitSwitch': (ref, input) => git.switchBranch(workspaceRef(ref), input),
    'projectTools:gitCreateBranch': (ref, input) => git.createBranch(workspaceRef(ref), input),
    'projectTools:gitOperation': (ref, action) => git.operation(workspaceRef(ref), action),
    'projectTools:openCopy': id => copies.open(id),
    'projectTools:removeCopy': (id, force) => copies.remove(id, force),
    'projectTools:forgetCopy': id => copies.forget(id),
    workspaces: async (projectId: string) => {
      const project = tools.resolve({ projectId }),
        git = await gitInfo(project.path)
      let children: Awaited<ReturnType<Copies['list']>> = []
      if (git.root) children = await copies.list(projectId)
      return [
        { projectId, name: project.name, path: project.path, copyId: null, branch: git.branch, error: null },
        ...children.map(copy => ({
          projectId,
          name: copy.name,
          path: copy.path,
          copyId: copy.id,
          branch: copy.branch,
          error: copy.error,
        })),
      ]
    },
  }
  const helperMethods: Record<HelperMethod, Handler> = {
    hello: () => ({
      protocol: REMOTE_PROTOCOL,
      platform: platform(),
      arch: arch(),
      hostname: hostname(),
      home: homedir(),
      node: process.versions.node,
      shell: process.env.SHELL || '/bin/sh',
    }),
    'platform:request': (id, requestId, model) => {
      const record = host.executionRecord(id)
      if (record) host.platformRequestContext(record)?.(requestId, model)
    },
    'platform:record': id => host.executionRecord(id),
  }
  const methods: Record<string, Handler> = { ...helperMethods, ...contractMethods }
  return {
    host,
    resolve,
    async call(method: string, args: unknown[]) {
      if (!Object.hasOwn(methods, method)) throw new Error('REMOTE_UNSUPPORTED: ' + method)
      return methods[method](...args)
    },
    async close() {
      await Promise.allSettled([services.shutdown(), host.shutdown()])
    },
  }
}
