import type { ProjectRecord, SessionRecord, SessionSummary } from '@pixelsky/protocol'
import type {
  MachineInput,
  MachineInfo,
  MachineState,
  MachineConnection,
  CheckItem,
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
  /** 重新检测 WSL 发行版，返回最新机器状态 */
  wslList(): Promise<MachineState>
  /** 只探测不连接，返回检查项 */
  wslCheck(id: string): Promise<CheckItem[]>
  /** 指定 / 清除（null）发行版里用的 Linux 版 node 路径 */
  wslSetNode(id: string, path: string | null): Promise<void>
  /** 打开该发行版的独立终端窗口 */
  wslTerminal(id: string): Promise<void>
  workspaces(projectId: string): Promise<WorkspaceChoice[]>
  openWorkspace(choice: WorkspaceChoice): Promise<SessionRecord>
  onChange(cb: (state: MachineState) => void): () => void
}
