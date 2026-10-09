import type {
  WorkspaceRef,
  WorkspaceTarget,
  DirectoryListing,
  FileDocument,
  EditorKind,
  EditorState,
} from '../shared/types/workspace'

export interface FilesBridge {
  target(ref: WorkspaceRef): Promise<WorkspaceTarget>
  list(ref: WorkspaceRef, path: string): Promise<DirectoryListing>
  search(ref: WorkspaceRef, name: string): Promise<DirectoryListing>
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
