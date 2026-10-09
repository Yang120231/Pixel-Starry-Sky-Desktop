import type { AlwaysScope, Effort, EngineId, PermissionMode } from './base'
import type { SessionSettings } from './session'

/** 引擎能力表：界面按它决定显示什么，组件里不判断是哪个引擎 */
export interface EngineCaps {
  /** 可直接发送图片内容块；缺省表示未接入。 */
  imageInput?: boolean
  /** 能中断当前这一轮 */
  interrupt: boolean
  /** 能恢复以前的会话 */
  resume: boolean
  /** 运行中引导；普通排队由宿主管理，不依赖这个能力 */
  steer: boolean
  /** 回退到某条用户消息之前（截断对话与引擎上下文） */
  rewind?: boolean
  /** 改模型 / 强度当轮生效（否则下一轮生效） */
  liveModelSwitch: boolean
  livePermissionSwitch: boolean
  /** 支持的权限模式 */
  permissionModes: PermissionMode[]
  /** 支持的推理强度，从低到高（滑块上的停靠点） */
  efforts: Effort[]
  /** 有 Ultracode 开关（Claude Code：每个任务都编排多个子智能体），能和任意推理强度搭配 */
  ultracode: boolean
  /** 有 Fast 模式开关 */
  fast: boolean
  /** 有「显示思考摘要」开关 */
  thinkingSummaries: boolean
  /** 报告后台任务（后台任务条） */
  backgroundTasks: boolean
  /** 有智能体追踪（子智能体条、追踪面板） */
  agentTrace: boolean
  /** 会给出输入建议 */
  promptSuggestions: boolean
  /** 审批时「始终允许」能选的范围；空数组表示没有「始终允许」 */
  alwaysScopes: AlwaysScope[]
  /** 报告花费（美元） */
  costUsd: boolean
  /** 有「检查更新」（Claude Code：claude update） */
  selfUpdate: boolean
  /** 设置里由像素星空管理的启动选项：输出风格、允许提问、自动压缩 */
  launchSettings: boolean
  /** 应用管理插件的命令 */
  pluginCommands: boolean
  /** 自有报错时提供「改用平台」 */
  platformSwitch: boolean
}

/**
 * 引擎状态：
 * - ready 可用
 * - missing 没找到可执行文件
 * - unauthenticated 没登录
 * - outdated 版本太低
 * - error 检测出错
 * - unsupported 像素星空还不支持（即将支持）
 */
export type EngineStatus = 'ready' | 'missing' | 'unauthenticated' | 'outdated' | 'error' | 'unsupported'

export interface EngineInfo {
  id: EngineId
  /** 显示名，例如「Claude Code」 */
  name: string
  /** 输入框里小方块上的两个字母，例如「Cc」 */
  short: string
  status: EngineStatus
  /** 检测到的版本号，例如「2.1.289」 */
  version: string | null
  /** 可执行文件路径 */
  path: string | null
  /** 不可用时告诉用户怎么解决的一句话 */
  message: string | null
  caps: EngineCaps
}

/** 新会话的默认设置：engine 是默认引擎，其余是这个引擎的默认值（会话里改过的选择也会记到所属引擎名下） */
export interface EngineDefaults extends SessionSettings {
  engine: EngineId
}

/** 每个引擎各自记的新会话默认值（设置 › 本机引擎 › 详情，docs/ui/engine-settings-redesign.md §3.2） */
export type SessionDefaults = Pick<
  SessionSettings,
  'model' | 'effort' | 'permissionMode' | 'ultracode' | 'fast' | 'thinkingSummaries'
>

/**
 * 每个引擎的本机配置（设置 › 本机引擎，docs/ui/plan-search-panes-compact.md §1、§3，engine-settings-redesign.md §3.2）：
 * - path：自定义可执行文件路径，覆盖自动查找
 * - env：在系统环境之上追加的环境变量（平台会话的网关变量仍然最后覆盖）
 * - compactModel：压缩上下文用的模型；null 表示跟随会话模型。目前只对平台会话生效
 * - defaults：新会话的默认值
 * - outputStyle：输出风格；null 表示跟随引擎自己的设置
 * - askQuestions：允许中途向用户提问（Claude 的 AskUserQuestion）；关掉时禁用这个工具
 * - autoCompactPct：上下文用到窗口的这个百分比时自动压缩；null 表示引擎内置阈值
 * - hidden：不在输入框的引擎菜单里显示（默认引擎不能隐藏）
 *
 * 除 defaults 外，改了对已开始的会话也生效：下一条消息开始前用新设置重启引擎进程并接上原对话。
 */
export interface EngineLocalConfig {
  path: string | null
  env: Record<string, string>
  compactModel: string | null
  defaults: SessionDefaults
  outputStyle: string | null
  askQuestions: boolean
  autoCompactPct: number | null
  hidden: boolean
}

export type EngineConfig = Record<EngineId, EngineLocalConfig>

export type EngineConfigPatch = Partial<Omit<EngineLocalConfig, 'defaults'>> & { defaults?: Partial<SessionDefaults> }

/** 引擎实际报上来的可选项（目前是输出风格），从引擎的初始化握手里读，读不到为空 */
export interface EngineCatalog {
  currentProvider?: string | null
  rateLimits?: unknown
  models?: EngineModel[]
  currentModel?: string | null
  authType?: string | null
  outputStyles: string[]
  /** 引擎自己的当前输出风格（不加我们的设置时） */
  currentOutputStyle: string | null
}

export interface EngineModel {
  id: string
  label: string
  /** 模型说明（引擎报上来的一句话） */
  description?: string
  /** 别名指向的完整模型 id，例如 opus → claude-opus-5-5 */
  resolved?: string
  efforts: Effort[]
  defaultEffort: Effort | null
  inputModalities: string[]
  isDefault: boolean
}

/** 检查更新的结果 */
export interface EngineUpdateResult {
  ok: boolean
  /** 引擎输出的最后几行，给用户看 */
  output: string
  /** 更新后重新检测到的版本 */
  version: string | null
}
