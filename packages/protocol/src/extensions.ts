export type ExtensionKind = 'plugin' | 'mcp' | 'cli' | 'skill'
export type ExtensionScope = { kind: 'global' } | { kind: 'project'; path: string }
export interface McpConfig {
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}
export interface ExtensionComponent {
  kind: ExtensionKind
  name: string
  description: string
  path?: string
  mcp?: McpConfig
  invocable?: boolean
}
export interface ExtensionCheck {
  status: 'connected' | 'ready' | 'error' | 'auth'
  message: string
  tools?: Array<{ name: string; description: string }>
  at: number
}
export interface ExtensionEntry {
  engines?: Array<'claude' | 'codex' | 'pixel'>
  id: string
  kind: ExtensionKind
  name: string
  description: string
  scope: ExtensionScope
  enabled: boolean
  origin: 'managed' | 'native'
  source: { kind: 'local' | 'git' | 'created' | 'native'; location: string; subdir?: string; revision?: string }
  path?: string
  version?: string
  components: ExtensionComponent[]
  mcp?: McpConfig
  command?: string
  args?: string[]
  digest?: string
  sourceDigest?: string
  edited?: boolean
  revision?: number
  check?: ExtensionCheck
  error?: string
}
export interface ExtensionState {
  entries: ExtensionEntry[]
  warnings: string[]
  revision: number
  secretsPersistent: boolean
}
export interface ExtensionInput {
  engines?: Array<'claude' | 'codex' | 'pixel'>
  id?: string
  kind: ExtensionKind
  name: string
  description?: string
  scope: ExtensionScope
  enabled?: boolean
  mcp?: McpConfig
  command?: string
  args?: string[]
  text?: string
  expectedVersion?: string
}
export interface ExtensionImport {
  engines?: Array<'claude' | 'codex' | 'pixel'>
  kind: 'plugin' | 'skill'
  source: 'local' | 'git'
  location: string
  subdir?: string
  scope: ExtensionScope
  name?: string
}
export interface ExtensionLaunch {
  codexConfig?: Record<string, unknown>
  /** 只加进引擎进程环境的变量（MCP 凭据），配置里按名字引用，不进命令行 */
  env?: Record<string, string>
  skillRoots?: string[]
  key: string
  pluginDirs: string[]
  mcpFile?: string
  /** 不用逐次审批的工具（Claude 的 permissions.allow 规则），例如只读的对话历史 MCP */
  allowTools?: string[]
  pathDirs: string[]
  dispose?: () => void
}
export interface SkillCommand {
  invocation?: 'slash' | 'skill'
  path?: string
  name: string
  description: string
  source: 'engine' | 'configured'
  /** Claude initialize 的原生标记；不能仅凭命令名称判定，用户技能可能同名。 */
  builtin?: boolean
}
