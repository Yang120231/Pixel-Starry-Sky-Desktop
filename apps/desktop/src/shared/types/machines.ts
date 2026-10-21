export interface MachineInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  auth: 'agent' | 'key' | 'password'
  privateKeyPath?: string
  password?: string
  passphrase?: string
}
/** WSL 检查卡片的一项（main 的探测生成，界面显示） */
export interface CheckItem {
  key: 'start' | 'encoding' | 'node' | 'claude' | 'codex' | 'pixel' | 'login'
  status: 'ok' | 'fail' | 'warn' | 'info'
  required: boolean
  /** 给界面显示的短事实（版本、路径、错误信息），不放中文句子 */
  detail: string
  /** 原因码，如 WSL_START_FAILED NODE_MISSING NODE_OLD NODE_BROKEN NODE_WINDOWS CLAUDE_MISSING ENCODING_NOT_UTF8 */
  code?: string
  /** 可复制的命令 */
  fix?: string
}
export interface WslDistro {
  name: string
  state: 'running' | 'stopped' | 'installing' | 'converting' | 'unknown'
  version: 1 | 2
  isDefault: boolean
}
export interface WslInfo {
  distro: string
  version: 1 | 2
  isDefault: boolean
  /** missing：之前见过，现在列表里没有了（已连接时才会留在界面上） */
  state: WslDistro['state'] | 'missing'
  lastCheck?: { at: number; items: CheckItem[] }
  /** 用户指定的 Linux 版 node 路径 */
  nodePath?: string
}
export interface MachineInfo {
  id: string
  kind: 'local' | 'ssh' | 'wsl'
  name: string
  host: string
  port: number
  username: string
  auth: 'local' | 'wsl' | MachineInput['auth']
  privateKeyPath?: string
  hasSecret: boolean
  status: 'local' | 'disconnected' | 'connecting' | 'connected' | 'error'
  error: string | null
  fingerprint: string | null
  platform: string | null
  home: string | null
  wsl?: WslInfo
}
export interface MachineState {
  currentId: string
  machines: MachineInfo[]
}
export interface MachineConnection {
  connected: boolean
  fingerprint?: string
  changed?: boolean
  /** WSL 没准备好时的检查项 */
  items?: CheckItem[]
}
export interface WorkspaceChoice {
  projectId: string
  name: string
  path: string
  copyId: string | null
  branch: string | null
  error: string | null
  sessionId?: string
}
