// 引擎系统（主进程）：把 EngineHost 接到 IPC。规格见 docs/engines.md §3、§5
//
// EngineHost 在 @pixelsky/engine 里，不依赖 Electron；这里只做三件事：
// 1. 收到渲染进程的请求就交给 core/engine/ops.ts 的操作表（只接受应用自己页面发来的请求）；
// 2. 把 EngineHost 的事件广播给所有窗口；
// 3. 「添加项目」「导出用量」弹出系统对话框；退出应用前关掉所有引擎进程。
// 同时按原顺序带起依赖引擎的模块：平台额度、SSH 机器、扩展、终端、产物面板的本机操作。
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import * as ipc from '../ipc/guard'
import { nativeText } from '../app/ui-language'
import { EngineHost } from '@pixelsky/engine'
import type { HostEvent } from '@pixelsky/protocol'
import type { AppContext } from '../app/context'
import { platformCharges, accountCalls } from '../platform/billing'
import { initPlatform, validateQueuedInput } from '../platform/platform'
import { Extensions } from '../extensions/ipc'
import { initTerminalIpc } from '../terminal/ipc'
import { initMachines } from '../machines/service'
import { machineOf } from '../machines/identity'
import { initArtifacts } from '../artifacts/ipc'
import { resolveTerminalTarget, workspaceToolsHost } from '../workspace/resolve'
import { ENGINE_OPS, type EngineOpContext } from '../core/engine/ops'
import { opEntries } from '../core/ops'
import { SearchRegistry } from '../core/search-registry'
import { usageQuery } from '../core/args'

export async function initEngine(ctx: AppContext): Promise<void> {
  const sessionEnv = await initPlatform(
    id =>
      machineOf(id) === 'local'
        ? (ctx.engine?.executionRecord(id) ?? null)
        : (ctx.machines?.call(machineOf(id), 'platform:record', [id]).catch(() => null) ?? null),
    () => ctx.engine?.engineConfig().claude.compactModel ?? null,
    record => {
      const machine = machineOf(record.id)
      if (machine === 'local') return ctx.engine?.platformRequestContext(record)
      return async (requestId, model) => {
        if (!ctx.machines) throw new Error('SSH_NOT_CONNECTED')
        await ctx.machines.call(machine, 'platform:request', [record.id, requestId, model])
      }
    },
  )
  const extensions = new Extensions(ctx)
  const h = new EngineHost({
    dataDir: join(app.getPath('userData'), 'engine'),
    // 有 SSH 机器时由它合并本机与远端的项目 / 会话再广播
    emit: (e: HostEvent) => (ctx.machines ? ctx.machines.hostEvent(e) : ctx.events.broadcast('engine:event', e)),
    sessionEnv,
    validateInput: validateQueuedInput,
    extensions: record => extensions.prepare(record),
    platformCharges,
  })
  ctx.engine = h
  const machines = await initMachines(ctx, h, sessionEnv)
  extensions.register()
  const shutdownTerminals = await initTerminalIpc(machines, ref => resolveTerminalTarget(ctx, ref))

  const handle = (channel: ipc.InvokeChannel, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipc.handle(channel, (event, ...args) => {
      if (channel.startsWith('engine:') && ctx.machines)
        return ctx.machines.invoke(channel, args, () => fn(event, ...args))
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
    tools: workspaceToolsHost(ctx),
    copyPath: async (projectId, copyId) => ctx.projectTools?.copyPath(projectId, copyId),
  }
  for (const [channel, op] of opEntries(ENGINE_OPS))
    handle(channel, (event, ...args) => op({ ...context, owner: owner(event) }, ...args))
  initArtifacts(h)
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

  ctx.lifecycle.onShutdown(shutdownTerminals)
  ctx.lifecycle.onShutdown(() => h.shutdown())
}
