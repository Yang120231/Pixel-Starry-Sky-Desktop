import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron'
import * as ipc from '../ipc/guard'
import { join } from 'node:path'
import { value } from '../core/project-tools/common'
import { ProjectTools } from '../core/project-tools/tools'
import { PROJECT_TOOL_OPS, listWorkspaces, openWorkspace } from '../core/project-tools/ops'
import { opEntries } from '../core/ops'
import { workspaceRef } from '../core/workspace-files'
import { nativeText } from '../app/ui-language'
import type { AppContext } from '../app/context'
import { workspaceToolsHost } from './resolve'
import { stopTerminalsUnder } from '../terminal/ipc'
import { initProjectBrowser } from './browser'
import { machineOf, remoteMethod } from '../machines/identity'
import type { WorkspaceChoice } from '../../shared/types/machines'

export async function initProjectTools(ctx: AppContext): Promise<void> {
  const host = workspaceToolsHost(ctx)
  const dir = join(app.getPath('userData'), 'project-tools')
  let timer: ReturnType<typeof setTimeout> | null = null
  const changed = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      ctx.events.broadcast('projectTools:changed')
    }, 80)
  }
  // Git 面板（docs/ui/git-panel.md）：本机放弃未跟踪文件时移到回收站
  const tools = new ProjectTools(dir, host, changed, {
    stopTerminals: stopTerminalsUnder,
    trash: async files => {
      for (const file of files) await shell.trashItem(file.absolute)
    },
  })
  ctx.projectTools = tools
  await tools.init()
  const context = { host, tools }
  ipc.handle('machines:workspaces', async (_event, projectId: string) => {
    const machine = machineOf(projectId)
    if (machine !== 'local') return ctx.machines!.call(machine, remoteMethod('machines:workspaces'), [projectId])
    return listWorkspaces(context, projectId)
  })
  ipc.handle('machines:openWorkspace', async (_event, choice: WorkspaceChoice) => {
    const machine = machineOf(choice.projectId)
    if (machine !== 'local')
      return ctx.machines!.call(machine, remoteMethod('machines:openWorkspace'), [
        { projectId: choice.projectId, copyId: choice.copyId },
      ])
    return openWorkspace(context, choice)
  })
  const handle = (channel: ipc.InvokeChannel, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipc.handle(channel, (event, ...args) => {
      return ctx.machines ? ctx.machines.invoke(channel, args, () => fn(event, ...args)) : fn(event, ...args)
    })
  }
  for (const [channel, op] of opEntries(PROJECT_TOOL_OPS)) {
    const run = (args: unknown[]) => op(context, ...args)
    ctx.toolOps.set(channel, run)
    handle(channel, (_event, ...args) => run(args))
  }
  // 以下只在本机：系统对话框、打开目录、打开网址
  handle('projectTools:chooseDirectory', async event => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, {
      title: nativeText(win, '选择项目文件夹'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('projectTools:openPath', async (_, ref) => {
    const error = await shell.openPath(host.resolve(workspaceRef(ref)).path)
    if (error) throw new Error(error)
  })
  handle('projectTools:revealCopy', async (_, id) => {
    const error = await shell.openPath(tools.copies.get(value(id, 200, true)).path)
    if (error) throw new Error(error)
  })
  handle('projectTools:openExternal', async (_, input) => {
    const url = new URL(value(input, 4000, true))
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP 或 HTTPS 地址')
    await shell.openExternal(url.href)
  })
  await initProjectBrowser(ctx, dir, host)
  ctx.lifecycle.onShutdown(async () => {
    if (timer) clearTimeout(timer)
    await tools.shutdown()
  })
}
