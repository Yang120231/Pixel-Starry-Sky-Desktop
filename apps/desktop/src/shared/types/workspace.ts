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
