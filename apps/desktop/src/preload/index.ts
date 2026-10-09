import { contextBridge, ipcRenderer } from 'electron'
import type { HostEvent } from '@pixelsky/protocol'
import type { AccountState } from '../shared/types/account'
import type { AccountBridge } from './account'
import type { AppInfoBridge } from './app-info'
import type { EngineBridge } from './engine'
import type { FilesBridge, EditorBridge } from './workspace'
import type { WindowState } from '../shared/types/window'
import type { WindowBridge } from './window'
import type { ExtensionsBridge } from './extensions'
import type { TerminalBridge } from './terminal'
import type { ProjectToolsBridge } from './project-tools'
import type { NotificationClick } from '../shared/types/notifications'
import type { NotificationsBridge } from './notifications'
import type { ArtifactsBridge } from './artifacts'

// 启动配置由主进程同步提供（沙箱里的 preload 拿不到命令行参数）
const config = ipcRenderer.sendSync('app:config') as { demo: boolean }

// 账号登录与额度：所有网络请求都在主进程，这里只转发 IPC（规格见 docs/ui/account.md §4.2）
const account: AccountBridge = {
  listCalls: query => ipcRenderer.invoke('account:calls', query),
  getState: () => ipcRenderer.invoke('account:get'),
  login: () => ipcRenderer.invoke('account:login'),
  cancelLogin: () => ipcRenderer.invoke('account:cancel'),
  logout: () => ipcRenderer.invoke('account:logout'),
  refresh: () => ipcRenderer.invoke('account:refresh'),
  onChange: cb => {
    const listener = (_event: Electron.IpcRendererEvent, s: AccountState): void => cb(s)
    ipcRenderer.on('account:changed', listener)
    return () => {
      ipcRenderer.removeListener('account:changed', listener)
    }
  },
}

/** invoke 抛出的错误带着「Error invoking remote method 'xxx': Error: 」前缀，去掉后只留给用户看的那句话 */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const message = String((err as Error)?.message ?? err).replace(
      /^Error invoking remote method '[^']+': (\w*Error: )?/,
      '',
    )
    throw new Error(message)
  }
}

// 引擎系统：会话都在主进程里跑，这里只转发 IPC（规格见 docs/engines.md §5）
const engine: EngineBridge = {
  search: query => call('engine:search', query),
  cancelSearch: id => call('engine:cancelSearch', id),
  config: () => call('engine:config'),
  setConfig: (engine, patch) => call('engine:setConfig', engine, patch),
  setDefaultEngine: engine => call('engine:setDefaultEngine', engine),
  catalog: (engine, force) => call('engine:catalog', engine, force),
  updateEngine: engine => call('engine:update', engine),
  retrySettings: () => call('engine:retrySettings'),
  setRetrySettings: maxRetries => call('engine:setRetrySettings', maxRetries),
  engines: force => call('engine:engines', !!force),
  defaults: () => call('engine:defaults'),
  projects: () => call('engine:projects'),
  addProject: () => call('engine:addProject'),
  removeProject: id => call('engine:removeProject', id),
  renameProject: (id, name) => call('engine:renameProject', id, name),
  sessions: () => call('engine:sessions'),
  createSession: opts => call('engine:createSession', opts),
  openSession: id => call('engine:openSession', id),
  send: (id, text) => call('engine:send', id, text),
  context: id => call('engine:context', id),
  compact: id => call('engine:compact', id),
  cancelQueued: (id, queueId) => call('engine:cancelQueued', id, queueId),
  moveQueued: (id, queueId, toIndex) => call('engine:moveQueued', id, queueId, toIndex),
  runQueuedNow: (id, queueId) => call('engine:runQueuedNow', id, queueId),
  steerQueued: (id, queueId, turnId) => call('engine:steerQueued', id, queueId, turnId),
  resumeQueue: id => call('engine:resumeQueue', id),
  rewind: (id, itemId) => call('engine:rewind', id, itemId),
  interrupt: id => call('engine:interrupt', id),
  interruptTurn: (id, turnId) => call('engine:interruptTurn', id, turnId),
  answer: (id, requestId, decision) => call('engine:answer', id, requestId, decision),
  updateSession: (id, patch) => call('engine:updateSession', id, patch),
  deleteSession: id => call('engine:deleteSession', id),
  archiveSession: (id, archived, stopRunning) => call('engine:archiveSession', id, archived, stopRunning),
  renameSession: (id, title) => call('engine:renameSession', id, title),
  setSessionBottom: (id, bottomed) => call('engine:setSessionBottom', id, bottomed),
  stopTask: (id, taskId) => call('engine:stopTask', id, taskId),
  taskOutput: (id, taskId) => call('engine:taskOutput', id, taskId),
  subagentTranscript: (id, agentId) => call('engine:subagentTranscript', id, agentId),
  usageSummary: q => call('engine:usageSummary', q),
  usageList: q => call('engine:usageList', q),
  usageExport: q => call('engine:usageExport', q),
  usageClear: () => call('engine:usageClear'),
  onEvent: cb => {
    const listener = (_event: Electron.IpcRendererEvent, e: HostEvent): void => cb(e)
    ipcRenderer.on('engine:event', listener)
    return () => {
      ipcRenderer.removeListener('engine:event', listener)
    }
  },
}

// 「关于」页：版本、运行环境，打开数据目录等（docs/ui/settings.md §5）
const appInfo: AppInfoBridge = {
  getInfo: () => call('app:info'),
  open: link => call('app:open', link),
}

// 渲染进程能用的能力只通过这里暴露，统一挂在 window.pixelsky 上
const files: FilesBridge = {
  target: ref => call('files:target', ref),
  list: (ref, path) => call('files:list', ref, path),
  search: (ref, name) => call('files:search', ref, name),
  status: ref => call('files:status', ref),
  read: (ref, path) => call('files:read', ref, path),
  headContent: (ref, path) => call('files:headContent', ref, path),
  save: (ref, path, text, version) => call('files:save', ref, path, text, version),
  reveal: (ref, path) => call('files:reveal', ref, path),
  copyPath: (ref, path) => call('files:copyPath', ref, path),
  onBeforeClose: cb => {
    const listener = (): void => cb()
    ipcRenderer.on('files:beforeClose', listener)
    return () => ipcRenderer.removeListener('files:beforeClose', listener)
  },
  finishClose: () => call('files:finishClose'),
}
const editor: EditorBridge = {
  state: force => call('editor:state', force),
  preferences: patch => call('editor:preferences', patch),
  choose: (kind, name, mode) => call('editor:choose', kind, name, mode),
  remove: id => call('editor:remove', id),
  open: (ref, id, path, line, col) => call('editor:open', ref, id, path, line, col),
}
const windowControls: WindowBridge = {
  getState: () => call('window:getState'),
  minimize: () => call('window:minimize'),
  toggleMaximize: () => call('window:toggleMaximize'),
  snap: (layout, zone) => call('window:snap', layout, zone),
  snapOptions: () => call('window:snapOptions'),
  restoreSnap: () => call('window:restoreSnap'),
  close: () => call('window:close'),
  onState: cb => {
    const listener = (_event: Electron.IpcRendererEvent, state: WindowState): void => cb(state)
    ipcRenderer.on('window:state', listener)
    return () => ipcRenderer.removeListener('window:state', listener)
  },
}
const projectTools: ProjectToolsBridge = {
  searchTasks: (text, id) => call('projectTools:searchTasks', text, id),
  tasks: id => call('projectTools:tasks', id),
  createTask: (id, input) => call('projectTools:createTask', id, input),
  updateTask: (id, patch) => call('projectTools:updateTask', id, patch),
  deleteTask: id => call('projectTools:deleteTask', id),
  reorderTasks: (id, ids) => call('projectTools:reorderTasks', id, ids),
  environment: (ref, force) => call('projectTools:environment', ref, force),
  services: ref => call('projectTools:services', ref),
  saveService: (ref, input) => call('projectTools:saveService', ref, input),
  deleteService: id => call('projectTools:deleteService', id),
  startService: id => call('projectTools:startService', id),
  stopService: (id, force) => call('projectTools:stopService', id, force),
  restartService: id => call('projectTools:restartService', id),
  portStatus: port => call('projectTools:portStatus', port),
  copies: id => call('projectTools:copies', id),
  branches: id => call('projectTools:branches', id),
  previewCopy: (id, input) => call('projectTools:previewCopy', id, input),
  createCopy: (id, input) => call('projectTools:createCopy', id, input),
  openCopy: id => call('projectTools:openCopy', id),
  removeCopy: (id, force) => call('projectTools:removeCopy', id, force),
  forgetCopy: id => call('projectTools:forgetCopy', id),
  chooseDirectory: () => call('projectTools:chooseDirectory'),
  openPath: ref => call('projectTools:openPath', ref),
  revealCopy: id => call('projectTools:revealCopy', id),
  openExternal: url => call('projectTools:openExternal', url),
  gitStatus: ref => call('projectTools:gitStatus', ref),
  gitDiff: (ref, input) => call('projectTools:gitDiff', ref, input),
  gitBranches: ref => call('projectTools:gitBranches', ref),
  gitStage: (ref, paths) => call('projectTools:gitStage', ref, paths),
  gitUnstage: (ref, paths) => call('projectTools:gitUnstage', ref, paths),
  gitDiscard: (ref, input) => call('projectTools:gitDiscard', ref, input),
  gitCommit: (ref, input) => call('projectTools:gitCommit', ref, input),
  gitPull: (ref, mode) => call('projectTools:gitPull', ref, mode),
  gitPush: (ref, input) => call('projectTools:gitPush', ref, input),
  gitFetch: ref => call('projectTools:gitFetch', ref),
  gitSwitch: (ref, input) => call('projectTools:gitSwitch', ref, input),
  gitCreateBranch: (ref, input) => call('projectTools:gitCreateBranch', ref, input),
  gitOperation: (ref, action) => call('projectTools:gitOperation', ref, action),
  onChange: cb => {
    const listener = (): void => cb()
    ipcRenderer.on('projectTools:changed', listener)
    return () => ipcRenderer.removeListener('projectTools:changed', listener)
  },
}
const projectBrowser: import('./project-browser').BrowserBridge = {
  state: ref => call('projectBrowser:state', ref),
  navigate: (ref, id, url) => call('projectBrowser:navigate', ref, id, url),
  select: (ref, id) => call('projectBrowser:select', ref, id),
  action: (ref, id, action) => call('projectBrowser:action', ref, id, action),
  viewport: (ref, bounds) => call('projectBrowser:viewport', ref, bounds),
  annotate: (ref, id, text) => call('projectBrowser:annotate', ref, id, text),
  removeAnnotation: (ref, id, annotationId) => call('projectBrowser:removeAnnotation', ref, id, annotationId),
  onChange: cb => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      state: import('../shared/types/project-browser').BrowserState,
    ): void => cb(state)
    ipcRenderer.on('projectBrowser:changed', listener)
    return () => ipcRenderer.removeListener('projectBrowser:changed', listener)
  },
}
const terminal: TerminalBridge = {
  state: force => call('terminal:state', force),
  setDefaultProfile: id => call('terminal:setDefaultProfile', id),
  saveProfile: profile => call('terminal:saveProfile', profile),
  removeProfile: id => call('terminal:removeProfile', id),
  resetProfiles: () => call('terminal:resetProfiles'),
  chooseProgram: () => call('terminal:chooseProgram'),
  create: (ref, profileId, requestId) => call('terminal:create', ref, profileId, requestId),
  write: (id, gen, data) => call('terminal:write', id, gen, data),
  resize: (id, gen, cols, rows) => call('terminal:resize', id, gen, cols, rows),
  ack: (id, gen, seq) => ipcRenderer.send('terminal:ack', id, gen, seq),
  focused: value => ipcRenderer.send('terminal:focused', value),
  rename: (id, title) => call('terminal:rename', id, title),
  close: (id, force) => call('terminal:close', id, force),
  restart: (id, force) => call('terminal:restart', id, force),
  clipboardRead: () => call('terminal:clipboardRead'),
  clipboardWrite: value => call('terminal:clipboardWrite', value),
  openLink: url => call('terminal:openLink', url),
  onEvent: cb => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<TerminalBridge['onEvent']>[0] extends (event: infer E) => void ? E : never,
    ): void => cb(value)
    ipcRenderer.on('terminal:event', listener)
    return () => ipcRenderer.removeListener('terminal:event', listener)
  },
}
// 产物面板（docs/ui/artifacts-panel.md）：读取经过引擎核对改动记录；打开 / 显示只在本机
const artifacts: ArtifactsBridge = {
  list: input => call('engine:artifacts', input),
  change: input => call('engine:artifactChange', input),
  read: target => call('engine:artifactRead', target),
  open: target => call('artifacts:open', target),
  reveal: target => call('artifacts:reveal', target),
}
// 系统通知：要不要提醒由渲染层判断，主进程负责弹出（docs/ui/notifications.md）
const notifications: NotificationsBridge = {
  supported: () => call('notify:supported'),
  show: input => call('notify:show', input),
  onClick: cb => {
    const listener = (_event: Electron.IpcRendererEvent, value: NotificationClick): void => cb(value)
    ipcRenderer.on('notify:clicked', listener)
    return () => ipcRenderer.removeListener('notify:clicked', listener)
  },
}
contextBridge.exposeInMainWorld('pixelsky', {
  machines: {
    state: () => call('machines:state'),
    save: input => call('machines:save', input),
    connect: (id, fingerprint) => call('machines:connect', id, fingerprint),
    disconnect: id => call('machines:disconnect', id),
    remove: id => call('machines:remove', id),
    select: id => call('machines:select', id),
    chooseKey: () => call('machines:chooseKey'),
    directories: (id, path) => call('machines:directories', id, path),
    addProject: (id, path) => call('machines:addProject', id, path),
    workspaces: id => call('machines:workspaces', id),
    openWorkspace: choice => call('machines:openWorkspace', choice),
    onChange: callback => {
      const listener = (_e: Electron.IpcRendererEvent, state: import('../shared/types/machines').MachineState) =>
        callback(state)
      ipcRenderer.on('machines:changed', listener)
      return () => ipcRenderer.removeListener('machines:changed', listener)
    },
  } satisfies import('./machines').MachineBridge,
  platform: process.platform,
  /** 演示模式：显示照参考图写的演示数据，而不是空界面 */
  demo: config.demo,
  /** 同步窗口底色；transparent 仅供其他平台的原生覆盖层使用。Windows 按钮自绘。 */
  setTheme: (theme: 'light' | 'dark', transparent = false) => ipcRenderer.send('theme:set', theme, transparent),
  setLocale: (locale: 'zh-CN' | 'en-US') => call('ui:locale', locale),
  account,
  platformCatalog: {
    groups: () => call('platform:groups'),
    models: (id: string) => call('platform:models', id),
  },
  engine,
  app: appInfo,
  files,
  editor,
  window: windowControls,
  projectTools,
  projectBrowser,
  terminal,
  notifications,
  artifacts,
  extensions: {
    state: ref => call('extensions:state', ref),
    save: data => call('extensions:save', data),
    import: data => call('extensions:import', data),
    importMcp: (json, scope) => call('extensions:importMcp', json, scope),
    toggle: (id, enabled) => call('extensions:toggle', id, enabled),
    remove: id => call('extensions:remove', id),
    check: (id, ref) => call('extensions:check', id, ref),
    update: (id, apply) => call('extensions:update', id, apply),
    skillText: (id, ref) => call('extensions:skillText', id, ref),
    choose: kind => call('extensions:choose', kind),
    reveal: (id, ref) => call('extensions:reveal', id, ref),
    commands: ref => call('extensions:commands', ref),
    onChange: callback => {
      const listener = (): void => callback()
      ipcRenderer.on('extensions:changed', listener)
      return () => ipcRenderer.removeListener('extensions:changed', listener)
    },
  } satisfies ExtensionsBridge,
})
