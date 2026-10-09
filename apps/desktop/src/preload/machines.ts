import type { ProjectRecord, SessionRecord, SessionSummary } from '@pixelsky/protocol'
import type {
  MachineInput,
  MachineInfo,
  MachineState,
  MachineConnection,
  WorkspaceChoice,
} from '../shared/types/machines'

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
