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
export interface MachineInfo {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: 'local' | MachineInput['auth']
  privateKeyPath?: string
  hasSecret: boolean
  status: 'local' | 'disconnected' | 'connecting' | 'connected' | 'error'
  error: string | null
  fingerprint: string | null
  platform: string | null
  home: string | null
}
export interface MachineState {
  currentId: string
  machines: MachineInfo[]
}
export interface MachineConnection {
  connected: boolean
  fingerprint?: string
  changed?: boolean
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
