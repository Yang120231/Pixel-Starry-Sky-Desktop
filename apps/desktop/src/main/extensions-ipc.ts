import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { object, scope, text } from '@pixelsky/engine'
import type { ExtensionScope, SessionRecord } from '@pixelsky/protocol'
import type { WorkspaceRef } from '../preload/workspace'
import { trustedSender } from './account'
import { ExtensionService } from './extensions/service'
import { resolveWorkspace } from './engine-ipc'
import { selectedMachine } from './machines/service'

let service: ExtensionService | null = null
export function extensionService(): ExtensionService {
  if (!service)
    service = new ExtensionService(
      join(app.getPath('userData'), 'extensions'),
      {
        available: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        encrypt: value => safeStorage.encryptString(value).toString('base64'),
        decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
      },
      () => ({ ...process.env, ...engineEnvironment?.() }),
    )
  return service
}
let engineEnvironment: ((engine?: 'claude' | 'codex') => Record<string, string>) | undefined
export function prepareExtensions(record: SessionRecord): import('@pixelsky/protocol').ExtensionLaunch {
  return extensionService().launch(record.cwd, record.engine, engineEnvironment?.(record.engine))
}
export function initExtensions(env: (engine?: 'claude' | 'codex') => Record<string, string>): void {
  engineEnvironment = env
  const project = (raw: unknown): string | null => {
    if (raw == null) return null
    const ref = object(raw)
    return realpathSync(resolveWorkspace(ref as WorkspaceRef).path)
  }
  const checkedScope = (raw: unknown): ExtensionScope => {
    const s = scope(raw)
    if (s.kind === 'project') {
      // 渲染进程只能选已注册项目；传入路径由项目列表核对。
      if (
        !projectsProvider?.().some(path => {
          try {
            return realpathSync(path).toLowerCase() === s.path.toLowerCase()
          } catch {
            return false
          }
        })
      )
        throw new Error('先添加该项目再设置项目范围')
    }
    return s
  }
  const changed = (): void => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('extensions:changed')
  }
  const handle = (name: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle('extensions:' + name, (event, ...args) => {
      if (!trustedSender(event)) throw new Error('不受信任的页面')
      if (selectedMachine() !== 'local') {
        if (name === 'commands') return []
        throw new Error('SSH_EXTENSIONS_REMOTE')
      }
      return fn(...args)
    })
  }
  const mutate = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    const value = await extensionService().mutate(fn)
    changed()
    return value
  }
  handle('state', ref => extensionService().state(project(ref)))
  handle('save', raw => {
    const data = object(raw)
    return mutate(() => extensionService().upsert({ ...data, scope: checkedScope(data.scope) }))
  })
  handle('import', raw => {
    const data = object(raw)
    return mutate(async () => {
      const s = checkedScope(data.scope),
        e = await extensionService().import({ ...data, scope: s })
      return extensionService()
        .state(s.kind === 'project' ? s.path : null)
        .entries.find(x => x.id === e.id)!
    })
  })
  handle('importMcp', (json, s) =>
    mutate(() => extensionService().importMcp(text(json, 'JSON', 2 * 1024 * 1024), checkedScope(s))),
  )
  handle('toggle', (id, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('开关值不正确')
    return mutate(() => extensionService().toggle(text(id, 'id'), enabled))
  })
  handle('remove', id => mutate(() => extensionService().remove(text(id, 'id'))))
  handle('check', (id, ref) => mutate(() => extensionService().check(text(id, 'id'), project(ref))))
  handle('update', (id, apply) => mutate(() => extensionService().update(text(id, 'id'), apply === true)))
  handle('skillText', (id, ref) => extensionService().skillText(text(id, 'id'), project(ref)))
  handle('commands', ref => extensionService().commands(project(ref)))
  handle('reveal', (id, ref) => {
    shell.showItemInFolder(extensionService().location(text(id, 'id'), project(ref)))
  })
  handle('choose', async kind => {
    const selected =
      kind === 'program'
        ? await dialog.showOpenDialog({ title: '选择命令行程序', properties: ['openFile'] })
        : await dialog.showOpenDialog({ title: '选择插件或技能目录', properties: ['openDirectory'] })
    return selected.canceled ? null : (selected.filePaths[0] ?? null)
  })
  app.on('will-quit', () => service?.close())
}
let projectsProvider: (() => string[]) | undefined
export function setExtensionProjects(fn: () => string[]): void {
  projectsProvider = fn
}
