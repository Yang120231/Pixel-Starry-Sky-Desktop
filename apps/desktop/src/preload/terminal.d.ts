import type { WorkspaceRef } from './workspace'
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
export interface TerminalBridge {
  state(force?: boolean): Promise<TerminalState>
  setDefaultProfile(id: string): Promise<TerminalState>
  saveProfile(profile: TerminalProfileInput): Promise<TerminalState>
  removeProfile(id: string): Promise<TerminalState>
  resetProfiles(): Promise<TerminalState>
  chooseProgram(): Promise<string | null>
  create(ref: WorkspaceRef, profileId: string | undefined, requestId: string): Promise<TerminalRecord>
  write(id: string, generation: number, data: string): Promise<void>
  resize(id: string, generation: number, cols: number, rows: number): Promise<void>
  ack(id: string, generation: number, seq: number): void
  focused(value: boolean): void
  rename(id: string, title: string): Promise<TerminalRecord>
  close(id: string, force?: boolean): Promise<void>
  restart(id: string, force?: boolean): Promise<TerminalRecord>
  clipboardRead(): Promise<string>
  clipboardWrite(text: string): Promise<void>
  openLink(url: string): Promise<void>
  onEvent(cb: (event: TerminalEvent) => void): () => void
}
