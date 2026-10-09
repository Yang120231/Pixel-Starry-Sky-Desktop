import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron'
import * as ipc from './ipc/guard'
import { join } from 'node:path'
import { Tasks } from './project-tools/tasks'
import { Services, portStatus } from './project-tools/services'
import { Copies } from './project-tools/copies'
import { GitTools } from './project-tools/git'
import { value, type ToolsHost } from './project-tools/common'
import { workspaceRef } from './workspace-files'
import { nativeText } from './ui-language'
import { registerShutdown } from './shutdown'
import type { CopyInput, ManualTask, ServiceInput } from '../shared/types/project-tools'
import { initProjectBrowser } from './project-tools/browser'
import { machines } from './machines/service'
import { machineOf, remoteMethod } from './machines/identity'
import { gitInfo } from './project-tools/common'
import type { WorkspaceChoice } from '../shared/types/machines'
export let resolveCopyPath: ((projectId: string, copyId: string) => Promise<string>) | undefined

export async function initProjectTools(host: ToolsHost): Promise<void> {
  const dir = join(app.getPath('userData'), 'project-tools')
  let timer: ReturnType<typeof setTimeout> | null = null
  const changed = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      for (const win of BrowserWindow.getAllWindows())
        if (!win.isDestroyed()) win.webContents.send('projectTools:changed')
    }, 80)
  }
  let copies!: Copies
  const tasks = new Tasks(dir, host, changed),
    services = new Services(dir, host, changed, (id, path) => copies.verifyPath(id, path))
  copies = new Copies(dir, host, changed, path => services.stopPath(path))
  resolveCopyPath = async (projectId, copyId) => {
    const copy = copies.get(copyId)
    if (copy.projectId !== projectId) throw new Error('副本不属于项目')
    await copies.verify(copy)
    return copy.path
  }
  // Git 面板（docs/ui/git-panel.md）：本机放弃未跟踪文件时移到回收站
  const git = new GitTools(host, changed, { trash: path => shell.trashItem(path) })
  await Promise.all([tasks.init(), copies.init()])
  await services.init()
  ipc.handle('machines:workspaces', async (_event, projectId: string) => {
    const machine = machineOf(projectId)
    if (machine !== 'local') return machines!.call(machine, remoteMethod('machines:workspaces'), [projectId])
    const target = host.resolve({ projectId }),
      info = await gitInfo(target.path)
    const children = info.root ? await copies.list(projectId) : []
    return [
      { projectId, name: target.name, path: target.path, copyId: null, branch: info.branch, error: null },
      ...children.map(copy => ({
        projectId,
        name: copy.name,
        path: copy.path,
        copyId: copy.id,
        branch: copy.branch,
        error: copy.error,
      })),
    ]
  })
  ipc.handle('machines:openWorkspace', async (_event, choice: WorkspaceChoice) => {
    const machine = machineOf(choice.projectId)
    if (machine !== 'local')
      return machines!.call(machine, remoteMethod('machines:openWorkspace'), [
        { projectId: choice.projectId, copyId: choice.copyId },
      ])
    if (choice.copyId) {
      const copy = copies.get(choice.copyId)
      if (copy.projectId !== choice.projectId) throw new Error('副本不属于项目')
      return copies.open(choice.copyId)
    }
    const target = host.resolve({ projectId: choice.projectId })
    return host.create(choice.projectId, target.path)
  })
  const handle = (name: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipc.handle(`projectTools:${name}` as ipc.InvokeChannel, (event, ...args) => {
      return machines ? machines.invoke('projectTools:' + name, args, () => fn(event, ...args)) : fn(event, ...args)
    })
  }
  handle('searchTasks', (_, text, projectId) => {
    const query = value(text, 200).toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (!query.length) return []
    return tasks.store.data.tasks
      .filter(task => {
        if (projectId !== null && task.projectId !== projectId) return false
        try {
          host.resolve({ projectId: task.projectId })
        } catch {
          return false
        }
        return query.every(term =>
          (task.title + '\n' + task.note + '\n' + task.tags.join(' ')).toLocaleLowerCase().includes(term),
        )
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
  })
  handle('tasks', (_, id) => tasks.state(value(id, 200, true)))
  handle('createTask', (_, id, input) => tasks.create(value(id, 200, true), input as Partial<ManualTask>))
  handle('updateTask', (_, id, input) => tasks.update(value(id, 200, true), input as Partial<ManualTask>))
  handle('deleteTask', (_, id) => tasks.remove(value(id, 200, true)))
  handle('reorderTasks', (_, id, ids) => tasks.reorder(value(id, 200, true), ids as string[]))
  handle('environment', (_, ref, force) => services.environment(workspaceRef(ref), force === true))
  handle('services', (_, ref) => services.list(workspaceRef(ref)))
  handle('saveService', (_, ref, input) => services.save(workspaceRef(ref), input as ServiceInput))
  handle('deleteService', (_, id) => services.remove(value(id, 200, true)))
  handle('startService', (_, id) => services.start(value(id, 200, true)))
  handle('stopService', (_, id, force) => services.stop(value(id, 200, true), force === true))
  handle('restartService', (_, id) => services.restart(value(id, 200, true)))
  handle('portStatus', (_, port) => portStatus(Number(port)))
  handle('copies', (_, id) => copies.list(value(id, 200, true)))
  handle('branches', (_, id) => copies.branches(value(id, 200, true)))
  handle('previewCopy', (_, id, input) => copies.preview(value(id, 200, true), input as CopyInput))
  handle('createCopy', (_, id, input) => copies.create(value(id, 200, true), input as CopyInput))
  handle('openCopy', (_, id) => copies.open(value(id, 200, true)))
  handle('removeCopy', (_, id, force) => copies.remove(value(id, 200, true), force === true))
  handle('forgetCopy', (_, id) => copies.forget(value(id, 200, true)))
  handle('chooseDirectory', async event => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, {
      title: nativeText(win, '选择项目文件夹'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('openPath', async (_, ref) => {
    const error = await shell.openPath(host.resolve(workspaceRef(ref)).path)
    if (error) throw new Error(error)
  })
  handle('revealCopy', async (_, id) => {
    const error = await shell.openPath(copies.get(value(id, 200, true)).path)
    if (error) throw new Error(error)
  })
  handle('openExternal', async (_, input) => {
    const url = new URL(value(input, 4000, true))
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP 或 HTTPS 地址')
    await shell.openExternal(url.href)
  })
  handle('gitStatus', (_, ref) => git.status(workspaceRef(ref)))
  handle('gitDiff', (_, ref, input) => git.diff(workspaceRef(ref), input as Parameters<GitTools['diff']>[1]))
  handle('gitBranches', (_, ref) => git.branches(workspaceRef(ref)))
  handle('gitStage', (_, ref, paths) => git.stage(workspaceRef(ref), paths))
  handle('gitUnstage', (_, ref, paths) => git.unstage(workspaceRef(ref), paths))
  handle('gitDiscard', (_, ref, input) => git.discard(workspaceRef(ref), input))
  handle('gitCommit', (_, ref, input) => git.commit(workspaceRef(ref), input))
  handle('gitPull', (_, ref, mode) => git.pull(workspaceRef(ref), mode))
  handle('gitPush', (_, ref, input) => git.push(workspaceRef(ref), input))
  handle('gitFetch', (_, ref) => git.fetch(workspaceRef(ref)))
  handle('gitSwitch', (_, ref, input) => git.switchBranch(workspaceRef(ref), input))
  handle('gitCreateBranch', (_, ref, input) => git.createBranch(workspaceRef(ref), input))
  handle('gitOperation', (_, ref, action) => git.operation(workspaceRef(ref), action))
  await initProjectBrowser(dir, host)
  registerShutdown(async () => {
    if (timer) clearTimeout(timer)
    await services.shutdown()
  })
}
