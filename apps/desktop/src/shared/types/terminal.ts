export type TerminalStatus = 'stopped' | 'starting' | 'running' | 'exited' | 'error'
export interface TerminalProfile {
  id: string
  label: string
  command: string
  args: string[]
  available: boolean
  custom?: boolean
}
export interface TerminalRecord {
  id: string
  projectId: string
  projectName: string
  cwd: string
  profileId: string
  profileLabel: string
  title: string
  titleEdited: boolean
  status: TerminalStatus
  exitCode?: number
  error?: string
  generation: number
  createdAt: number
  lastStartedAt?: number
}
export type TerminalEvent =
  | { type: 'data'; terminalId: string; generation: number; seq: number; data: string }
  | { type: 'record'; record: TerminalRecord }
export interface TerminalState {
  profiles: TerminalProfile[]
  defaultProfileId: string
  terminals: TerminalRecord[]
}
export interface TerminalProfileInput {
  id?: string
  label: string
  command: string
  args: string[]
}
