// 引擎系统（主进程）：把 EngineHost 接到 IPC。规格见 docs/engines.md §3、§5
//
// EngineHost 在 @pixelsky/engine 里，不依赖 Electron；这里只做三件事：
// 1. 收到渲染进程的请求就交给 core/engine/ops.ts 的操作表（只接受应用自己页面发来的请求）；
// 2. 把 EngineHost 的事件广播给所有窗口；
// 3. 「添加项目」「导出用量」弹出系统对话框；「用默认应用打开」只限本机；退出应用前关掉所有引擎进程。
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron'
import * as ipc from './ipc/guard'
import { nativeText } from './ui-language'
import { EngineHost } from '@pixelsky/engine'
import type { HostEvent } from '@pixelsky/protocol'
import { platformCharges, accountCalls } from './platformBilling'
import { initPlatform, validateQueuedInput } from './platform'
import { initExtensions, prepareExtensions, setExtensionProjects } from './extensions-ipc'
import { initTerminalIpc } from './terminal/ipc'
import { registerShutdown } from './shutdown'
import type { TerminalTarget } from './terminal/manager'
import type { WorkspaceRef, WorkspaceTarget } from '../shared/types/workspace'
import { machines, initMachines } from './machines/service'
import { machineOf } from './machines/identity'
import { resolveCopyPath } from './project-tools'
import { openable } from './core/artifact-files'
import { ENGINE_OPS, type EngineOpContext } from './core/engine/ops'
import { opEntries } from './core/ops'
import { createToolsHost } from './core/project-tools/tools'
import { resolveLocalWorkspace } from './core/workspace/resolve'
import { SearchRegistry } from './core/search-registry'
import { artifactRef, usageQuery } from './core/args'

let host: EngineHost | null = null

/** 桌面文件、编辑器、项目工具共用的工作区解析：远端机器的项目由 machines.target 解析，本机的交给 core */
export function resolveWorkspace(ref: WorkspaceRef): WorkspaceTarget {
  if (machineOf(ref.projectId ?? ref.sessionId) !== 'local') {
    const target = machines?.target(ref)
    if (target) return target
    throw new Error('SSH_NOT_CONNECTED')
  }
  if (!host) throw new Error('项目尚未加载')
  return resolveLocalWorkspace(host, ref)
}

/** Project tools only create sessions in worktrees already validated by their manager. */
export const projectToolsHost = createToolsHost({
  host: () => host,
  resolve: resolveWorkspace,
  record: id => (machineOf(id) === 'local' ? host?.record(id) : machines?.record(id)),
})

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

function broadcast(e: HostEvent): void {
  if (machines) {
    machines.hostEvent(e)
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('engine:event', e)
  }
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

  const handle = (channel: ipc.InvokeChannel, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipc.handle(channel, (event, ...args) => {
      if (channel.startsWith('engine:') && machines) return machines.invoke(channel, args, () => fn(event, ...args))
      return fn(event, ...args)
    })
  }

  handle('account:calls', (_e, query) => accountCalls(query))
  // 搜索 / 产物扫描按窗口分桶；窗口关闭时中止它还没跑完的查询
  const searches = new SearchRegistry(),
    scans = new SearchRegistry()
  const observed = new Set<number>()
  const owner = (event: IpcMainInvokeEvent): string => {
    const sender = event.sender,
      key = String(sender.id)
    if (!observed.has(sender.id)) {
      observed.add(sender.id)
      sender.once('destroyed', () => {
        searches.release(key)
        scans.release(key)
        observed.delete(sender.id)
      })
    }
    return key
  }
  const context: Omit<EngineOpContext, 'owner'> = {
    host: h,
    searches,
    scans,
    tools: projectToolsHost,
    copyPath: async (projectId, copyId) => resolveCopyPath?.(projectId, copyId),
  }
  for (const [channel, op] of opEntries(ENGINE_OPS))
    handle(channel, (event, ...args) => op({ ...context, owner: owner(event) }, ...args))
  // 用默认应用打开 / 在文件夹中显示：只限本机，只限改动记录里的文件
  for (const action of ['open', 'reveal'] as const)
    ipc.handle(`artifacts:${action}`, async (_event, input) => {
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
  handle('engine:addProject', async e => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: nativeText(win, '选择项目文件夹'), properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return h.addProject(r.filePaths[0])
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

  registerShutdown(shutdownTerminals)
  registerShutdown(() => h.shutdown())
}
