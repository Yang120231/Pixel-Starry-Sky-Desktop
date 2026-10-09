import type { ProjectRecord, SessionRecord, SessionSummary } from '@pixelsky/protocol'

export interface MachineInput {
  id?: string; name: string; host: string; port: number; username: string
  auth: 'agent' | 'key' | 'password'; privateKeyPath?: string; password?: string; passphrase?: string
}
export interface MachineInfo {
  id: string; name: string; host: string; port: number; username: string
  auth: 'local' | MachineInput['auth']; privateKeyPath?: string; hasSecret: boolean
  status: 'local' | 'disconnected' | 'connecting' | 'connected' | 'error'
  error: string | null; fingerprint: string | null; platform: string | null; home: string | null
}
export interface MachineState { currentId: string; machines: MachineInfo[] }
export interface MachineConnection { connected: boolean; fingerprint?: string; changed?: boolean }
export interface WorkspaceChoice { projectId: string; name: string; path: string; copyId: string | null; branch: string | null; error: string | null; sessionId?: string }
export interface MachineBridge {
  state(): Promise<MachineState>
  save(input: MachineInput): Promise<MachineInfo>
  connect(id: string, fingerprint?: string): Promise<MachineConnection>
  disconnect(id: string): Promise<void>
  remove(id: string): Promise<void>
  select(id: string): Promise<{ projects: ProjectRecord[]; sessions: SessionSummary[] }>
  chooseKey(): Promise<string | null>
  directories(id: string, path?: string): Promise<{ path: string; parent: string | null; directories: string[] }>
  addProject(id: string, path: string): Promise<ProjectRecord>
  workspaces(projectId: string): Promise<WorkspaceChoice[]>
  openWorkspace(choice: WorkspaceChoice): Promise<SessionRecord>
  onChange(cb: (state: MachineState) => void): () => void
}
