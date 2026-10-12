import { app, BrowserWindow, clipboard, dialog, shell, type IpcMainInvokeEvent } from 'electron'
import { Editors } from '../core/editors'
import * as ipc from '../ipc/guard'
import { WorkspaceFiles, workspacePath, workspaceRef, type TargetResolver } from '../core/workspace-files'
import type { AppContext } from '../app/context'
import { resolveWorkspace } from './resolve'
import { FILE_OPS } from '../core/workspace/ops'
import { opEntries } from '../core/ops'
import type { EditorKind } from '../../shared/types/workspace'
import { nativeText } from '../app/ui-language'
import { memoryFile } from '../core/memory-files'
import { machineOf } from '../machines/identity'

export async function initWorkspace(ctx: AppContext): Promise<void> {
  const resolveTarget: TargetResolver = ref => resolveWorkspace(ctx, ref)
  // 文件树删除：移到系统回收站（docs/ui/files-search-terminal-pins.md §3）
  const files = new WorkspaceFiles(resolveTarget, { trash: absolute => shell.trashItem(absolute) })
  const icons = new Map<string, string>()
  const editors = new Editors(app.getPath('userData'), resolveTarget, async path => {
    if (!icons.has(path)) icons.set(path, (await app.getFileIcon(path, { size: 'small' })).toDataURL())
    return icons.get(path)
  })
  await editors.init()
  const handle = (name: ipc.InvokeChannel, fn: (e: IpcMainInvokeEvent, ...args: never[]) => unknown): void => {
    ipc.handle(
      name,
      (e, ...args) =>
        ctx.machines && (name.startsWith('files:') || name === 'editor:open')
          ? ctx.machines.invoke(name, args, () => fn(e, ...args))
          : fn(e, ...args),
      { deny: '不允许的调用方' },
    )
  }
  for (const [channel, op] of opEntries(FILE_OPS)) {
    const run = (args: unknown[]) => op({ files }, ...args)
    ctx.toolOps.set(channel, run)
    handle(channel, (_e, ...args) => run(args))
  }
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
  // 上下文明细里项目外的记忆文件（docs/ui/context-window.md §7）：只开本机会话诊断里列出的文件；
  // 有默认编辑器就用它打开，没有用系统默认程序；reveal 在文件夹里显示
  handle('editor:openMemory', async (_e, sessionId: unknown, path: unknown, action: unknown) => {
    if (typeof sessionId !== 'string' || machineOf(sessionId) !== 'local') throw new Error('只能打开本机上的记忆文件')
    const listed = ctx.engine?.open(sessionId).context?.diagnostic?.memory ?? []
    const file = await memoryFile(listed, path)
    if (action === 'reveal') return void shell.showItemInFolder(file)
    if (await editors.openFile(file)) return
    const err = await shell.openPath(file)
    if (err) throw new Error('打不开这个文件：' + err)
  })
}
