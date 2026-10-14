export type WorkspaceRef = { sessionId: string; projectId?: never } | { projectId: string; sessionId?: never }
export interface WorkspaceTarget {
  ref: WorkspaceRef
  name: string
  path: string
}
/** 「从一个文件夹导入…」列出的一个子文件夹（docs/ui/multi-root-projects.md §2） */
export interface ImportCandidate {
  name: string
  path: string
  /** 里面有 .git、package.json 之类，默认勾上 */
  project: boolean
  /** 已经是项目 */
  added: boolean
}
export interface ImportCandidates {
  parent: string
  candidates: ImportCandidate[]
  /** 子文件夹太多，只列了前面一部分 */
  truncated: boolean
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
/** 项目文件内容搜索的一条命中（docs/ui/files-search-terminal-pins.md §2） */
export interface GrepMatch {
  /** 相对项目，用 / 分隔 */
  path: string
  line: number
  column: number
  /** 这一行的内容（过长时截断） */
  text: string
}
export interface GrepResult {
  matches: GrepMatch[]
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
export type EditorKind = 'vscode' | 'cursor' | 'windsurf' | 'trae-cn' | 'trae' | 'jetbrains' | 'custom'
export interface EditorItem {
  id: string
  name: string
  kind: EditorKind
  path: string
  /** code：VS Code 一类（--reuse-window、--goto）；jetbrains：IntelliJ 一类（--line、--column）；folder：只传路径 */
  mode: 'code' | 'jetbrains' | 'folder'
  available: boolean
  manual: boolean
  version?: string
  source?: 'shortcut' | 'location' | 'path' | 'manual'
  icon?: string
}
export interface EditorState {
  items: EditorItem[]
  defaultId: string | null
  openWith: string
  window: 'reuse' | 'new'
  checkedAt: number
  /** 「打开方式」里编辑器以外的程序（GitHub #12）：文件资源管理器、Git Bash、终端；只列本机装了的 */
  tools: OpenTool[]
  /** 「打开方式」按钮直接点时用哪个（编辑器或程序的 id）；没选过时为 null，用默认编辑器 */
  workspaceId: string | null
}
export type OpenToolId =
  | 'explorer'
  | 'git-bash'
  | 'windows-terminal'
  | 'pwsh'
  | 'powershell'
  /** macOS 的「终端」、Linux 的默认终端 */
  | 'terminal'
  | 'iterm'
export interface OpenTool {
  id: OpenToolId
  name: string
  path: string
}
