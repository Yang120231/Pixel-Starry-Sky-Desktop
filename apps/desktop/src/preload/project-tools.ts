import type { SessionRecord } from '@pixelsky/protocol'
import type { WorkspaceRef } from '../shared/types/workspace'
import type {
  ManualTask,
  TaskState,
  ServiceDefinition,
  ServiceInput,
  EnvironmentState,
  ProjectCopy,
  CopyInput,
  CopyPreview,
  GitArea,
  GitStatus,
  GitDiff,
  GitBranch,
  GitResult,
  GitPaths,
  GitPullMode,
} from '../shared/types/project-tools'

export interface ProjectToolsBridge {
  searchTasks(text: string, projectId: string | null): Promise<ManualTask[]>
  tasks(projectId: string): Promise<TaskState>
  createTask(projectId: string, input: Partial<ManualTask>): Promise<ManualTask>
  updateTask(id: string, patch: Partial<ManualTask>): Promise<ManualTask>
  deleteTask(id: string): Promise<void>
  reorderTasks(projectId: string, ids: string[]): Promise<void>
  environment(ref: WorkspaceRef, force?: boolean): Promise<EnvironmentState>
  services(ref: WorkspaceRef): Promise<ServiceDefinition[]>
  saveService(ref: WorkspaceRef, input: ServiceInput): Promise<ServiceDefinition>
  deleteService(id: string): Promise<void>
  startService(id: string): Promise<ServiceDefinition>
  stopService(id: string, force?: boolean): Promise<void>
  restartService(id: string): Promise<ServiceDefinition>
  portStatus(port: number): Promise<{ occupied: boolean; pid: string | null; suggested: number }>
  copies(projectId: string): Promise<ProjectCopy[]>
  branches(projectId: string): Promise<string[]>
  previewCopy(projectId: string, input: CopyInput): Promise<CopyPreview>
  createCopy(projectId: string, input: CopyInput): Promise<ProjectCopy>
  openCopy(id: string): Promise<SessionRecord>
  removeCopy(id: string, force?: boolean): Promise<void>
  forgetCopy(id: string): Promise<void>
  chooseDirectory(): Promise<string | null>
  openPath(ref: WorkspaceRef): Promise<void>
  revealCopy(id: string): Promise<void>
  openExternal(url: string): Promise<void>
  gitStatus(ref: WorkspaceRef): Promise<GitStatus>
  gitDiff(ref: WorkspaceRef, input: { path: string; area: GitArea; origPath?: string | null }): Promise<GitDiff>
  gitBranches(ref: WorkspaceRef): Promise<GitBranch[]>
  gitStage(ref: WorkspaceRef, paths: GitPaths): Promise<GitResult>
  gitUnstage(ref: WorkspaceRef, paths: GitPaths): Promise<GitResult>
  gitDiscard(ref: WorkspaceRef, input: { paths: string[]; untracked: string[] } | 'all'): Promise<GitResult>
  gitCommit(ref: WorkspaceRef, input: { message: string; all: boolean; push: boolean }): Promise<GitResult>
  gitPull(ref: WorkspaceRef, mode: GitPullMode): Promise<GitResult>
  gitPush(ref: WorkspaceRef, input: { publish: boolean }): Promise<GitResult>
  gitFetch(ref: WorkspaceRef): Promise<GitResult>
  gitSwitch(ref: WorkspaceRef, input: { branch: string; remote: boolean }): Promise<GitResult>
  gitCreateBranch(ref: WorkspaceRef, input: { name: string }): Promise<GitResult>
  gitOperation(ref: WorkspaceRef, action: 'abort' | 'continue'): Promise<GitResult>
  onChange(cb: () => void): () => void
}
