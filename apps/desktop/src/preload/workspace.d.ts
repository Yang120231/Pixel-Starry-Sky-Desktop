export type WorkspaceRef = { sessionId: string; projectId?: never } | { projectId: string; sessionId?: never }
export interface WorkspaceTarget {
  ref: WorkspaceRef
  name: string
  path: string
}
export interface FileEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
  status?: string
  linked?: boolean
}
export interface DirectoryListing {
  entries: FileEntry[]
  truncated: boolean
}
export type FileDocument =
  | {
      kind: 'text'
      path: string
      content: string
      version: string
      bytes: number
      bom: boolean
      newline: 'lf' | 'crlf'
      readonly?: boolean
    }
  | { kind: 'image'; path: string; dataUrl: string; bytes: number }
  | { kind: 'unsupported'; path: string; reason: string; bytes: number }
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
export type EditorKind = 'vscode' | 'cursor' | 'windsurf' | 'trae-cn' | 'trae' | 'custom'
export interface EditorItem {
  id: string
  name: string
  kind: EditorKind
  path: string
  mode: 'code' | 'folder'
  available: boolean
  manual: boolean
  version?: string
  source?: 'registry' | 'location' | 'path' | 'manual'
  icon?: string
}
export interface EditorState {
  items: EditorItem[]
  defaultId: string | null
  openWith: string
  window: 'reuse' | 'new'
  checkedAt: number
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
