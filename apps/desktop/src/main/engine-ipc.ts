import { platformCharges, accountCalls } from './platformBilling'
// 引擎系统（主进程）：把 EngineHost 接到 IPC。规格见 docs/engines.md §3、§5
//
// EngineHost 在 @pixelsky/engine 里，不依赖 Electron；这里只做三件事：
// 1. 收到渲染进程的请求就调用 EngineHost（只接受应用自己页面发来的请求）；
// 2. 把 EngineHost 的事件广播给所有窗口；
// 3. 「添加项目」弹出系统的选择文件夹对话框；退出应用前关掉所有引擎进程。
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { nativeText } from './ui-language'
import { EngineHost, searchQuery, type UsageQuery } from '@pixelsky/engine'
import type {
  ApprovalDecision,
  EngineConfigPatch,
  HostEvent,
  UsageDimension,
  UsageFilter,
  UsageRangeId,
} from '@pixelsky/protocol'
import type { SessionPatch } from '../shared/types/engine'
import { initPlatform, validateQueuedInput } from './platform'
import { initExtensions, prepareExtensions, setExtensionProjects } from './extensions-ipc'
import { initTerminalIpc } from './terminal/ipc'
import { registerShutdown } from './shutdown'
import { samePath } from './project-tools/common'
import type { TerminalTarget } from './terminal/manager'
import type { WorkspaceRef } from '../shared/types/workspace'
import { machines, initMachines } from './machines/service'
import { machineOf } from './machines/identity'
import { resolveCopyPath } from './project-tools'
import { workspaceRef } from './workspace-files'
import { openable, readArtifact } from './artifact-files'
import { isAbsolute } from 'node:path'
import { shell } from 'electron'

let host: EngineHost | null = null

/** Project tools only create sessions in worktrees already validated by their manager. */
export const projectToolsHost: import('./project-tools/common').ToolsHost = {
  resolve(ref) {
    const target = resolveWorkspace(ref)
    const projectId =
      ref.projectId ??
      (machineOf(ref.sessionId) === 'local' ? host?.record(ref.sessionId!) : machines?.record(ref.sessionId!))
        ?.projectId
    if (!projectId) throw new Error('项目不存在')
    return { projectId, name: target.name, path: target.path }
  },
  plans(projectId) {
    if (!host) return []
    return host
      .sessions()
      .filter(s => s.record.projectId === projectId && !s.record.archivedAt)
      .flatMap(s => {
        const items = host!
          .open(s.record.id)
          .items.filter(
            (item): item is Extract<import('@pixelsky/protocol').Item, { kind: 'todo' }> => item.kind === 'todo',
          )
        const item = items.at(-1)
        return item ? [{ sessionId: s.record.id, title: s.record.title, item }] : []
      })
  },
  sessions(path) {
    return (
      host
        ?.sessions()
        .filter(s => samePath(s.record.cwd, path))
        .map(s => ({ id: s.record.id, title: s.record.title, state: s.state })) ?? []
    )
  },
  create(projectId, cwd) {
    if (!host) throw new Error('项目尚未加载')
    return host.createSession({ projectId }, cwd)
  },
  async withStopped(path, action) {
    if (!host) throw new Error('项目尚未加载')
    return host.withWorkspaceStopped(path, action)
  },
}

/** 桌面文件与编辑器只读取已有的目标，不启动或重建会话引擎。 */
export function resolveWorkspace(
  ref: import('../shared/types/workspace').WorkspaceRef,
): import('../shared/types/workspace').WorkspaceTarget {
  if (machineOf(ref.projectId ?? ref.sessionId) !== 'local') {
    const target = machines?.target(ref)
    if (target) return target
    throw new Error('SSH_NOT_CONNECTED')
  }
  if (!host) throw new Error('项目尚未加载')
  if (ref.sessionId) {
    const record = host.record(ref.sessionId)
    if (!record) throw new Error('会话已不存在')
    const project = host.projects().find(p => p.id === record.projectId)
    const durableRef =
      project && project.path.toLowerCase() === record.cwd.toLowerCase() ? { projectId: project.id } : ref
    return { ref: durableRef, path: record.cwd, name: project?.name ?? record.cwd.split(/[\\/]/).pop() ?? record.title }
  }
  const project = host.projects().find(p => p.id === ref.projectId)
  if (!project) throw new Error('项目已不存在')
  return { ref, path: project.path, name: project.name }
}

export function resolveTerminalTarget(ref: WorkspaceRef): TerminalTarget {
  if (!host) throw new Error('项目尚未加载')
  if ('projectId' in ref) {
    const project = host.projects().find(item => item.id === ref.projectId)
    if (!project) throw new Error('项目已不存在')
    return { projectId: project.id, projectName: project.name, cwd: project.path }
  }
  const record = host.record(ref.sessionId)
  if (!record) throw new Error('会话已不存在')
  const project = host.projects().find(item => item.id === record.projectId)
  if (!project) throw new Error('项目已不存在')
  return { projectId: project.id, projectName: project.name, cwd: record.cwd }
}

/** 只接受应用自己的页面（打包后的本地文件，或开发服务器）发来的请求 */
function trustedSender(event: IpcMainInvokeEvent): boolean {
  try {
    const u = new URL(event.senderFrame?.url ?? '')
    if (u.protocol === 'file:') return true
    const dev = process.env.ELECTRON_RENDERER_URL
    return !!dev && !app.isPackaged && u.origin === new URL(dev).origin
  } catch {
    return false
  }
}

function broadcast(e: HostEvent): void {
  if (machines) {
    machines.hostEvent(e)
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('engine:event', e)
  }
}

const RANGES: readonly UsageRangeId[] = ['today', '7d', '30d', '90d']
const DIMENSIONS: readonly UsageDimension[] = ['model', 'project', 'engine', 'route']

/** 用量查询参数（docs/ui/usage.md §6.3）：只取认识的字段 */
function usageQuery(v: unknown): UsageQuery {
  const q = (v ?? {}) as { range?: unknown; filter?: unknown; now?: unknown }
  const range = RANGES.includes(q.range as UsageRangeId) ? (q.range as UsageRangeId) : 'today'
  const filter: UsageFilter = {}
  const raw = (q.filter ?? {}) as Record<string, unknown>
  for (const d of DIMENSIONS) if (typeof raw[d] === 'string') filter[d] = raw[d] as string
  const now = typeof q.now === 'number' && Number.isFinite(q.now) ? q.now : Date.now()
  return { range, filter, now }
}

function int(v: unknown, fallback: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : fallback
}

/** 产物接口的参数：会话 id + 绝对路径 / 条目 id */
function artifactRef(input: unknown): { sessionId: string; path: string; itemId?: unknown } {
  const v = (input ?? {}) as { sessionId?: unknown; path?: unknown; itemId?: unknown }
  const sessionId = str(v.sessionId, 'sessionId')
  const path = typeof v.path === 'string' ? v.path : ''
  if (path && (!isAbsolute(path) || path.includes('\0') || path.length > 4096)) throw new Error('文件路径不正确')
  return { sessionId, path, itemId: v.itemId }
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`参数 ${name} 不对`)
  return v
}

export async function initEngine(): Promise<void> {
  const sessionEnv = await initPlatform(
    id =>
      machineOf(id) === 'local'
        ? (host?.executionRecord(id) ?? null)
        : (machines?.call(machineOf(id), 'platform:record', [id]).catch(() => null) ?? null),
    () => host?.engineConfig().claude.compactModel ?? null,
    record => {
      const machine = machineOf(record.id)
      if (machine === 'local') return host?.platformRequestContext(record)
      return async (requestId, model) => {
        if (!machines) throw new Error('SSH_NOT_CONNECTED')
        await machines.call(machine, 'platform:request', [record.id, requestId, model])
      }
    },
  )
  const h = new EngineHost({
    dataDir: join(app.getPath('userData'), 'engine'),
    emit: broadcast,
    sessionEnv,
    validateInput: validateQueuedInput,
    extensions: prepareExtensions,
    platformCharges,
  })
  host = h
  await initMachines(h, sessionEnv)
  setExtensionProjects(() => h.projects().map(p => p.path))
  initExtensions((engine = 'claude') => h.engineConfig()[engine].env)
  const shutdownTerminals = await initTerminalIpc(resolveTerminalTarget)

  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trustedSender(event)) throw new Error('不受信任的页面')
      if (channel.startsWith('engine:') && machines) return machines.invoke(channel, args, () => fn(event, ...args))
      return fn(event, ...args)
    })
  }

  handle('account:calls', (_e, query) => accountCalls(query))
  handle('engine:engines', (_e, force) => h.engines(force === true))
  const searches = new Map<number, { requestId: number; controller: AbortController }>()
  const observedSearchSenders = new Set<number>()
  handle('engine:search', async (event, value) => {
    const q = searchQuery(value),
      senderId = event.sender.id
    const old = searches.get(senderId)
    if (old && old.requestId > q.requestId)
      return { requestId: q.requestId, results: [], cancelled: true, truncated: false, partial: false, sessionCount: 0 }
    old?.controller.abort()
    const job = { requestId: q.requestId, controller: new AbortController() }
    searches.set(senderId, job)
    if (!observedSearchSenders.has(senderId)) {
      observedSearchSenders.add(senderId)
      event.sender.once('destroyed', () => {
        searches.get(senderId)?.controller.abort()
        searches.delete(senderId)
        observedSearchSenders.delete(senderId)
      })
    }
    try {
      return await h.search(q, job.controller.signal)
    } catch (err) {
      if (!job.controller.signal.aborted) throw err
      return { requestId: q.requestId, results: [], cancelled: true, truncated: false, partial: false, sessionCount: 0 }
    } finally {
      if (searches.get(senderId) === job) searches.delete(senderId)
    }
  })
  // 产物面板（docs/ui/artifacts-panel.md §5）：工作区由主进程按会话 / 项目解析，不信任渲染层传来的路径
  const artifactJobs = new Map<number, { requestId: number; controller: AbortController }>()
  handle('engine:artifacts', async (event, input) => {
    const v = (input ?? {}) as { requestId?: unknown; sessionId?: unknown; projectId?: unknown; days?: unknown }
    const target = projectToolsHost.resolve(
      workspaceRef(v.sessionId ? { sessionId: v.sessionId } : { projectId: v.projectId }),
    )
    const requestId = Number(v.requestId),
      senderId = event.sender.id
    const old = artifactJobs.get(senderId)
    if (old && old.requestId > requestId)
      return { requestId, turns: [], delivered: [], outsideCount: 0, truncated: false, partial: false, cancelled: true }
    old?.controller.abort()
    const job = { requestId, controller: new AbortController() }
    artifactJobs.set(senderId, job)
    try {
      return await h.artifacts(
        { requestId, projectId: target.projectId, days: v.days },
        target.path,
        job.controller.signal,
      )
    } catch (err) {
      if (!job.controller.signal.aborted) throw err
      return { requestId, turns: [], delivered: [], outsideCount: 0, truncated: false, partial: false, cancelled: true }
    } finally {
      if (artifactJobs.get(senderId) === job) artifactJobs.delete(senderId)
    }
  })
  handle('engine:artifactChange', (_e, input) => {
    const v = artifactRef(input)
    return h.artifactItem(v.sessionId, str(v.itemId, 'itemId'))
  })
  handle('engine:artifactRead', async (_e, input) => {
    const v = artifactRef(input)
    if (!(await h.recordedPath(v.sessionId, v.path))) throw new Error('只能打开 AI 改动记录里的文件')
    return readArtifact(v.path)
  })
  // 用默认应用打开 / 在文件夹中显示：只限本机，只限改动记录里的文件
  for (const action of ['open', 'reveal'] as const)
    ipcMain.handle('artifacts:' + action, async (event, input) => {
      if (!trustedSender(event)) throw new Error('不受信任的页面')
      const v = artifactRef(input)
      if (machineOf(v.sessionId) !== 'local') throw new Error('远程机器上的文件只能预览')
      if (!(await h.recordedPath(v.sessionId, v.path))) throw new Error('只能打开 AI 改动记录里的文件')
      if (action === 'reveal') {
        shell.showItemInFolder(v.path)
        return
      }
      if (!openable(v.path)) throw new Error('出于安全考虑，这类文件不能直接打开')
      const error = await shell.openPath(v.path)
      if (error) throw new Error(error)
    })
  handle('engine:cancelSearch', (event, id) => {
    const job = searches.get(event.sender.id)
    if (job && job.requestId === id) job.controller.abort()
  })
  handle('engine:defaults', () => h.defaults())
  handle('engine:config', () => h.engineConfig())
  handle('engine:setConfig', (_e, engine, patch) => {
    if (engine !== 'claude' && engine !== 'codex') throw new Error('未知引擎')
    const p = (patch ?? {}) as Record<string, unknown>
    const out: EngineConfigPatch = {}
    if (p.path === null || typeof p.path === 'string') out.path = p.path
    if (p.compactModel === null || typeof p.compactModel === 'string') out.compactModel = p.compactModel
    if (p.env && typeof p.env === 'object')
      out.env = Object.fromEntries(
        Object.entries(p.env as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
      )
    // 详情页的选项：类型在这里先过一遍，取值范围由 EngineHost 校验（docs/ui/engine-settings-redesign.md）
    if (p.defaults && typeof p.defaults === 'object') out.defaults = p.defaults as EngineConfigPatch['defaults']
    if (p.outputStyle === null || typeof p.outputStyle === 'string') out.outputStyle = p.outputStyle
    if (typeof p.askQuestions === 'boolean') out.askQuestions = p.askQuestions
    if (p.autoCompactPct === null || typeof p.autoCompactPct === 'number') out.autoCompactPct = p.autoCompactPct
    if (typeof p.hidden === 'boolean') out.hidden = p.hidden
    return h.setEngineConfig(engine, out)
  })
  handle('engine:setDefaultEngine', (_e, engine) => {
    if (engine !== 'claude' && engine !== 'codex') throw new Error('未知引擎')
    return h.setDefaultEngine(engine)
  })
  handle('engine:catalog', (_e, engine, force) => {
    if (engine !== 'claude' && engine !== 'codex') throw new Error('未知引擎')
    return h.engineCatalog(engine, force === true)
  })
  handle('engine:update', (_e, engine) => {
    if (engine !== 'claude' && engine !== 'codex') throw new Error('未知引擎')
    return h.updateEngine(engine)
  })
  handle('engine:retrySettings', () => h.retrySettings())
  handle('engine:setRetrySettings', (_e, maxRetries) => h.setRetrySettings(maxRetries))
  handle('engine:projects', () => h.projects())
  handle('engine:addProject', async e => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: nativeText(win, '选择项目文件夹'), properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return h.addProject(r.filePaths[0])
  })
  handle('engine:removeProject', (_e, id) => h.removeProject(str(id, 'id')))
  handle('engine:renameProject', (_e, id, name) => h.renameProject(str(id, 'id'), name))
  handle('engine:sessions', () => h.sessions())
  handle('engine:createSession', async (_e, opts) => {
    const o = (opts ?? {}) as Parameters<EngineHost['createSession']>[0] & {
      copyId?: string | null
      workspaceSessionId?: string
    }
    const origin = o.workspaceSessionId ? h.record(o.workspaceSessionId) : null
    if (o.workspaceSessionId && origin?.projectId !== o.projectId) throw new Error('工作区不属于项目')
    const cwd = o.copyId ? await resolveCopyPath?.(o.projectId, o.copyId) : origin?.cwd
    if (o.copyId && !cwd) throw new Error('副本不存在')
    return h.createSession({ ...o, projectId: str(o.projectId, 'projectId') }, cwd)
  })
  handle('engine:openSession', (_e, id) => h.openSession(str(id, 'id')))
  handle('engine:send', (_e, id, input) => h.send(str(id, 'id'), input as Parameters<EngineHost['send']>[1]))
  handle('engine:context', (_e, id) => h.inspectContext(str(id, 'id')))
  handle('engine:compact', (_e, id) => h.compactContext(str(id, 'id')))
  handle('engine:cancelQueued', (_e, id, q) => h.cancelQueued(str(id, 'id'), str(q, 'queueId')))
  handle('engine:moveQueued', (_e, id, q, to) => h.moveQueued(str(id, 'id'), str(q, 'queueId'), int(to, 0, 100_000)))
  handle('engine:runQueuedNow', (_e, id, q) => h.runQueuedNow(str(id, 'id'), str(q, 'queueId')))
  handle('engine:steerQueued', (_e, id, q, turn) =>
    h.steerQueued(str(id, 'id'), str(q, 'queueId'), str(turn, 'turnId')),
  )
  handle('engine:resumeQueue', (_e, id) => h.resumeQueue(str(id, 'id')))
  handle('engine:rewind', (_e, id, itemId) => h.rewind(str(id, 'id'), str(itemId, 'itemId')))
  handle('engine:interrupt', (_e, id) => h.interrupt(str(id, 'id')))
  handle('engine:interruptTurn', (_e, id, turnId) => h.interruptTurn(str(id, 'id'), str(turnId, 'turnId')))
  handle('engine:answer', (_e, id, requestId, decision) =>
    h.answer(str(id, 'id'), str(requestId, 'requestId'), decision as ApprovalDecision),
  )
  handle('engine:updateSession', (_e, id, patch) => h.update(str(id, 'id'), (patch ?? {}) as SessionPatch))
  handle('engine:deleteSession', (_e, id) => h.deleteSession(str(id, 'id')))
  handle('engine:renameSession', (_e, id, title) => h.renameSession(str(id, 'id'), title))
  handle('engine:setSessionBottom', (_e, id, bottomed) => {
    if (typeof bottomed !== 'boolean') throw new Error('置底值不正确')
    return h.setSessionBottom(str(id, 'id'), bottomed)
  })
  handle('engine:archiveSession', (_e, id, archived, stopRunning) => {
    if (typeof archived !== 'boolean') throw new Error('归档值不正确')
    return h.archiveSession(str(id, 'id'), archived, stopRunning === true)
  })
  handle('engine:stopTask', (_e, id, taskId) => h.stopTask(str(id, 'id'), str(taskId, 'taskId')))
  handle('engine:taskOutput', (_e, id, taskId) => h.taskOutput(str(id, 'id'), str(taskId, 'taskId')))
  handle('engine:subagentTranscript', (_e, id, agentId) => h.subagentTranscript(str(id, 'id'), str(agentId, 'agentId')))

  // 用量与调用记录（docs/ui/usage.md §6.3）
  handle('engine:usageSummary', (_e, q) => h.usageSummary(usageQuery(q)))
  handle('engine:usageList', (_e, q) => {
    const o = (q ?? {}) as { offset?: unknown; limit?: unknown }
    return h.usageList({
      ...usageQuery(q),
      offset: int(o.offset, 0, Number.MAX_SAFE_INTEGER),
      limit: int(o.limit, 50, 500),
    })
  })
  handle('engine:usageExport', async (e, q) => {
    const query = usageQuery(q)
    const d = new Date(query.now)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const opts = {
      title: '导出用量记录',
      defaultPath: join(app.getPath('downloads'), `pixelsky-usage-${day}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    opts.title = nativeText(win, opts.title)
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, h.usageCsv(query), 'utf8')
    return true
  })
  handle('engine:usageClear', () => h.usageClear())

  registerShutdown(shutdownTerminals)
  registerShutdown(() => h.shutdown())
}
