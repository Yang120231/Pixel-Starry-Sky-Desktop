import type {
  WorkspaceRef,
  WorkspaceTarget,
  DirectoryListing,
  FileDocument,
  GrepResult,
  EditorKind,
  EditorState,
} from '../shared/types/workspace'

export interface FilesBridge {
  target(ref: WorkspaceRef): Promise<WorkspaceTarget>
  list(ref: WorkspaceRef, path: string): Promise<DirectoryListing>
  search(ref: WorkspaceRef, name: string): Promise<DirectoryListing>
  /** 内容搜索（docs/ui/files-search-terminal-pins.md §2） */
  grep(ref: WorkspaceRef, query: string): Promise<GrepResult>
  /** 新建空文件 / 文件夹，返回相对项目的路径 */
  create(ref: WorkspaceRef, path: string, kind: 'file' | 'folder'): Promise<{ path: string }>
  /** 项目内重命名或移动，返回新的相对路径 */
  rename(ref: WorkspaceRef, from: string, to: string): Promise<{ path: string }>
  /** 移到回收站 */
  remove(ref: WorkspaceRef, path: string): Promise<void>
  status(ref: WorkspaceRef): Promise<Record<string, string>>
  read(ref: WorkspaceRef, path: string): Promise<FileDocument>
  headContent(ref: WorkspaceRef, path: string): Promise<string | null>
  save(
    ref: WorkspaceRef,
    path: string,
    content: string,
    version: string,
  ): Promise<Extract<FileDocument, { kind: 'text' }>>
  reveal(ref: WorkspaceRef, path?: string): Promise<void>
  copyPath(ref: WorkspaceRef, path?: string): Promise<void>
  onBeforeClose(cb: () => void): () => void
  finishClose(): Promise<void>
}
export interface EditorBridge {
  state(force?: boolean): Promise<EditorState>
  preferences(patch: { defaultId?: string | null; openWith?: string; window?: 'reuse' | 'new' }): Promise<EditorState>
  choose(kind: EditorKind, name?: string, mode?: 'code' | 'folder'): Promise<EditorState | null>
  remove(id: string): Promise<EditorState>
  open(
    ref: WorkspaceRef,
    editorId?: string,
    path?: string,
    line?: number,
    column?: number,
  ): Promise<{ editor: string; target: string }>
}
