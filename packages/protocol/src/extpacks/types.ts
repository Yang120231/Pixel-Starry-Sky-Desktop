// 扩展包（extension pack）的共享类型和常量：主进程、预加载、渲染进程都用这一份。
// 纯 TS，不依赖 node 类型。

export type ExtText = string | { zh: string; en?: string }
export type ExtLocale = 'zh-CN' | 'en-US'

export interface ExtGrammar {
  language?: string
  aliases?: string[]
  extensions?: string[]
  filenames?: string[]
  filenamePatterns?: string[]
  firstLine?: string | null
  scopeName: string
  path: string
  configuration?: string
  embeddedLanguages?: Record<string, string>
  injectTo?: string[]
  samples: string[]
}
export interface ExtTheme {
  id: string
  label: ExtText
  uiTheme: 'dark' | 'light'
  path: string
}
export interface ExtSnippets {
  language: string
  path: string
}
export interface ExtIconTheme {
  id: string
  label: ExtText
  path: string
  partial?: boolean
}
export interface ExtTaskDef {
  name: string
  description?: ExtText
  when?: string
}
export interface ExtTaskExtract {
  pattern: string
  flags?: string
  name: number
  description?: number | { commentBefore: string }
}
export interface ExtTaskRunner {
  windows?: string
  default: string
  fallback?: string
  when?: string
}
export interface ExtTaskTemplate {
  id: string
  label: ExtText
  icon?: string
  files: string[]
  tasks?: ExtTaskDef[]
  extract?: ExtTaskExtract[]
  runner?: ExtTaskRunner
  command: string
  cwd?: string
}
export interface ExtSkill {
  path: string
  engines?: Array<'claude' | 'codex'>
}
export interface ExtPrompt {
  id: string
  title: ExtText
  description?: ExtText
  path: string
  where?: Array<'composer' | 'editor'>
  requires?: 'selection'
}
export interface ExtPackContributes {
  grammars?: ExtGrammar[]
  themes?: ExtTheme[]
  snippets?: ExtSnippets[]
  iconThemes?: ExtIconTheme[]
  taskTemplates?: ExtTaskTemplate[]
  skills?: ExtSkill[]
  prompts?: ExtPrompt[]
}
export type ExtPackContributionKind = keyof ExtPackContributes
export interface ExtPackManifest {
  id: string
  name: string
  version: string
  publisher: string
  description: string
  icon?: string
  keywords?: string[]
  license: string
  repository?: string | null
  homepage?: string | null
  engines: { pixelsky: string }
  l10n?: { en?: { name?: string; description?: string } }
  contributes: ExtPackContributes
  main: null
  permissions: unknown[]
  price: null
}
export type ExtPackSource = 'builtin' | 'folder'
export interface ExtPackIssue {
  severity: 'error' | 'warning'
  /** pack: 整个扩展不加载；contribution: 该条贡献不生效；file: 该文件不使用 / 不提供 */
  scope: 'pack' | 'contribution' | 'file'
  /** 稳定的代码，例如 'manifest.unknownField' */
  code: string
  message: { zh: string; en: string }
  path?: string
  contribution?: { kind: ExtPackContributionKind; index: number }
  /** 以后上传检查对它的处理（给作者的提示）；undefined = 只在本地提示 */
  upload?: 'reject' | 'hint'
}
export type ExtPackInactive = Partial<Record<ExtPackContributionKind, number[]>>
/** overrideBuiltin 存语法的覆盖键 = `grammar.language ?? grammar.scopeName` */
export interface ExtPackOptions {
  overrideBuiltin?: string[]
}
export interface ExtPackSkillInfo {
  name: string
  description: string
  engines: Array<'claude' | 'codex'>
  index: number
}
export interface ExtPackInfo {
  key: string
  id: string | null
  source: ExtPackSource
  path: string
  enabled: boolean
  addedAt: number
  revision: number
  status: 'ok' | 'warning' | 'error'
  manifest: ExtPackManifest | null
  /** enabled && status !== 'error'（没有 scope:'pack' 的错误） */
  live: boolean
  /** 被 scope:'contribution' 错误停用的贡献的清单下标；生效 = live 且下标不在里面 */
  inactive: ExtPackInactive
  issues: ExtPackIssue[]
  options: ExtPackOptions
  skills: ExtPackSkillInfo[]
}
export interface ExtPackState {
  revision: number
  loading: boolean
  packs: ExtPackInfo[]
}
export interface ExtTaskTemplateWire {
  packKey: string
  packId: string
  /** 清单下标 */
  index: number
  template: ExtTaskTemplate
}
export interface ExtPackFileEntry {
  path: string
  size: number
  kind: 'file' | 'symlink'
}
/** readText：文件不存在或太大返回 null；按 UTF-8 严格解码并去掉 BOM（编码问题由校验器通过 readBytes 报告） */
export interface ExtPackReader {
  exists(path: string): boolean
  size(path: string): number | null
  readText(path: string): string | null
  readBytes(path: string, maxBytes: number): Uint8Array | null
  list(prefix: string): string[]
}

export const EXT_MANIFEST = 'pixelsky-extension.json'
export const EXT_ASSET_SCHEME = 'pixelsky-ext'
export const EXT_LIMITS = {
  fileBytes: 2 * 1024 * 1024,
  packBytes: 10 * 1024 * 1024,
  files: 500,
  filesWithIcons: 3000,
  scanFiles: 5000,
  scanBytes: 50 * 1024 * 1024,
  samplesBytes: 200 * 1024,
  iconBytes: 32 * 1024,
  pathChars: 128,
  promptChars: 8000,
  snippetsPerFile: 500,
  snippetPrefixChars: 30,
  tasksPerFile: 200,
  extractBytes: 1024 * 1024,
  manifestBytes: 256 * 1024,
  textBytes: 256 * 1024,
  lineChars: 10_000,
  lineMs: 30,
} as const

/** 软件内置的 26 个语言 id（authoring-spec §4.5） */
export const EXT_BUILTIN_LANGUAGE_IDS: readonly string[] = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'json',
  'css',
  'html',
  'markdown',
  'python',
  'rust',
  'go',
  'yaml',
  'toml',
  'shellscript',
  'sql',
  'java',
  'kotlin',
  'scala',
  'groovy',
  'c',
  'cpp',
  'csharp',
  'xml',
  'properties',
  'ini',
  'dockerfile',
]
/** 语法可以写出名字、但这里没有对应 TextMate 语法的内置作用域（不支持 → 警告） */
export const EXT_BUILTIN_SCOPES: readonly string[] = [
  'source.js',
  'source.ts',
  'source.css',
  'text.html.basic',
  'source.json',
  'source.python',
  'source.shell',
  'source.sql',
  'text.html.markdown',
]
/** 内置任务已经认领的文件名（Gradle 自 0.4 起内置，spec §8 由 WP1 更新） */
export const EXT_RESERVED_TASK_FILES: readonly string[] = [
  'package.json',
  'Makefile',
  'makefile',
  'GNUmakefile',
  'Cargo.toml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
]
export const EXT_RESERVED_TASK_IDS: readonly string[] = ['npm', 'make', 'cargo', 'gradle']
