import { app, BrowserWindow, clipboard, dialog, shell, type IpcMainInvokeEvent } from 'electron'
import { Editors } from './editors'
import * as ipc from './ipc/guard'
import { WorkspaceFiles, workspacePath, workspaceRef, type TargetResolver } from './workspace-files'
import type { EditorKind } from '../shared/types/workspace'
import { nativeText } from './ui-language'
import { machines } from './machines/service'

export async function initWorkspace(resolveTarget: TargetResolver): Promise<void> {
  const files = new WorkspaceFiles(resolveTarget)
  const icons = new Map<string, string>()
  const editors = new Editors(app.getPath('userData'), resolveTarget, async path => {
    if (!icons.has(path)) icons.set(path, (await app.getFileIcon(path, { size: 'small' })).toDataURL())
    return icons.get(path)
  })
  await editors.init()
  const handle = (name: ipc.InvokeChannel, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    ipc.handle(
      name,
      (e, ...args) =>
        machines && (name.startsWith('files:') || name === 'editor:open')
          ? machines.invoke(name, args, () => fn(e, ...args))
          : fn(e, ...args),
      { deny: '不允许的调用方' },
    )
  }
  handle('files:target', (_e, ref) => files.target(ref))
  handle('files:list', (_e, ref, path) => files.list(workspaceRef(ref), path))
  handle('files:search', (_e, ref, name) => files.search(workspaceRef(ref), name))
  handle('files:status', (_e, ref) => files.status(workspaceRef(ref)))
  handle('files:read', (_e, ref, path) => files.read(workspaceRef(ref), path))
  handle('files:headContent', (_e, ref, path) => files.headContent(workspaceRef(ref), path))
  handle('files:save', (_e, ref, path, text, version) => files.save(workspaceRef(ref), path, text, version))
  handle('files:reveal', async (_e, ref, path = '') => {
    const target = files.target(ref)
    const file = await workspacePath(target.path, path)
    if (path) shell.showItemInFolder(file)
    else {
      const err = await shell.openPath(file)
      if (err) throw new Error('打不开项目目录：' + err)
    }
  })
  handle('files:copyPath', async (_e, ref, path = '') => {
    clipboard.writeText(await workspacePath(files.target(ref).path, path))
  })
  handle('editor:state', (_e, force) => editors.state(force === true))
  handle('editor:preferences', (_e, patch) => editors.preferences(patch))
  handle('editor:remove', (_e, id) => {
    if (typeof id !== 'string') throw new Error('编辑器 ID 不正确')
    return editors.remove(id)
  })
  handle('editor:choose', async (e, kind: EditorKind, name?: string, mode?: 'code' | 'folder') => {
    if (!['vscode', 'cursor', 'windsurf', 'trae-cn', 'trae', 'custom'].includes(kind)) throw new Error('未知编辑器')
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 60))
      throw new Error('编辑器名称不正确')
    if (mode !== undefined && mode !== 'code' && mode !== 'folder') throw new Error('打开方式不正确')
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      title: nativeText(win, '选择编辑器程序'),
      filters: [{ name: nativeText(win, '程序'), extensions: process.platform === 'win32' ? ['exe'] : ['*'] }],
      properties: ['openFile' as const],
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    return editors.configure(kind, result.filePaths[0], name, mode)
  })
  handle('editor:open', (_e, ref, id, path, line, col) => editors.open(workspaceRef(ref), id, path, line, col))
}
