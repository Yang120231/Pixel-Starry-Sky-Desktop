// 引擎描述 + 能力表（docs/engines.md §4）：纯数据，界面和引擎层共用
import type { EngineCaps, EngineId } from './types'

export interface EngineDescriptor {
  id: EngineId
  name: string
  short: string
  caps: EngineCaps
  /** 请求格式：messages（Anthropic 接口）或 responses（OpenAI Responses 接口）；平台分组按它筛选 */
  wireApi: 'messages' | 'responses'
  /** 平台目录里属于这个引擎的供应商名（小写），例如 anthropic、openai */
  platformVendors: string[]
  /** 平台分组没有写平台字段时，是否算作这个引擎（旧目录兼容） */
  unlabeledGroups: boolean
  /** 品牌强调色（CSS 变量或颜色值），没有就是 null */
  accent: string | null
  /** 本机模型名的前缀，用来判断一个模型名是不是这个引擎认识的；没有前缀约定就是 null */
  nativeModelPrefix: string | null
}

export const ENGINES: Record<EngineId, EngineDescriptor> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'Cc',
    caps: {
      imageInput: true,
      interrupt: true,
      resume: true,
      steer: false,
      rewind: true,
      rewindCode: true,
      fork: true,
      sideChat: true,
      liveModelSwitch: true,
      livePermissionSwitch: true,
      permissionModes: ['ask', 'edits', 'plan', 'full'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      ultracode: true,
      fast: true,
      thinkingSummaries: true,
      backgroundTasks: true,
      agentTrace: true,
      promptSuggestions: true,
      alwaysScopes: ['session', 'project', 'user'],
      costUsd: true,
      selfUpdate: true,
      launchSettings: true,
      pluginCommands: true,
      platformSwitch: true,
    },
    wireApi: 'messages',
    platformVendors: ['anthropic', 'claude'],
    unlabeledGroups: true,
    accent: 'var(--engine-claude)',
    nativeModelPrefix: 'claude-',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    short: 'Cx',
    caps: {
      imageInput: true,
      interrupt: true,
      resume: true,
      steer: true,
      rewind: false,
      liveModelSwitch: false,
      livePermissionSwitch: false,
      permissionModes: ['ask', 'edits', 'full'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      ultracode: false,
      fast: false,
      thinkingSummaries: true,
      backgroundTasks: false,
      agentTrace: true,
      promptSuggestions: false,
      alwaysScopes: ['session'],
      costUsd: false,
      selfUpdate: false,
      launchSettings: false,
      pluginCommands: false,
      platformSwitch: false,
    },
    wireApi: 'responses',
    platformVendors: ['openai'],
    unlabeledGroups: false,
    accent: null,
    nativeModelPrefix: null,
  },
}

export const ENGINE_ORDER: readonly EngineId[] = ['claude', 'codex']
