// 演示模式下的平台目录（--demo）。真实目录来自适配层 /v1/platform/groups（docs/ui/platform-groups.md）
import type { EngineCaps, EngineCatalog, EngineConfig, EngineInfo, EngineLocalConfig } from '@pixelsky/protocol'
import type { PlatformGroupInfo } from '../../../preload/platform-catalog'

export const demoPlatformGroups: PlatformGroupInfo[] = [
  {
    id: '11',
    name: 'Claude 官方线路',
    description: '直连官方，稳定',
    platform: 'anthropic',
    rate_multiplier: 1,
    billing_source: 'balance_only',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  },
  {
    id: '12',
    name: 'Pro 月卡',
    description: '订阅额度内不扣余额',
    platform: 'anthropic',
    rate_multiplier: 1,
    billing_source: 'plan_only',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  },
  {
    id: '13',
    name: '特价线路',
    description: '高峰期可能排队',
    platform: 'anthropic',
    rate_multiplier: 0.6,
    billing_source: 'balance_only',
    models: ['claude-sonnet-5-5', 'claude-haiku-4-5'],
  },
]

/** 设置 › 本机引擎用到的引擎信息（真实数据是 EngineInfo，演示数据只填这些） */
export type EngineLite = Pick<EngineInfo, 'id' | 'name' | 'status' | 'version' | 'message' | 'path'> & {
  caps: Pick<EngineCaps, 'permissionModes' | 'efforts' | 'ultracode' | 'fast' | 'thinkingSummaries'>
}

/** 演示模式下本机引擎的检测结果（设置 › 本机引擎） */
export const demoEngineStatus: EngineLite[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    status: 'ready',
    version: '2.1.291',
    message: null,
    path: 'C:\\Users\\linxia\\.local\\bin\\claude.exe',
    caps: {
      permissionModes: ['ask', 'edits', 'plan', 'full'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      ultracode: true,
      fast: true,
      thinkingSummaries: true,
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    status: 'unsupported',
    version: null,
    message: '即将支持',
    path: null,
    caps: {
      permissionModes: ['ask', 'edits', 'full'],
      efforts: ['low', 'medium', 'high', 'xhigh'],
      ultracode: false,
      fast: true,
      thinkingSummaries: true,
    },
  },
]

/** 演示模式下 Claude Code 报上来的输出风格（设置 › 本机引擎 › 对话） */
export const demoEngineCatalog: EngineCatalog = {
  outputStyles: ['default', 'Proactive', 'Concise', 'Explanatory', 'Learning'],
  currentOutputStyle: 'default',
}

const demoLocal = (): EngineLocalConfig => ({
  path: null,
  env: {},
  compactModel: null,
  defaults: { model: null, effort: 'high', permissionMode: 'edits', ultracode: false, fast: false, thinkingSummaries: true },
  outputStyle: null,
  askQuestions: true,
  autoCompactPct: null,
  hidden: false,
})

/** 演示模式下本机引擎的配置（设置 › 本机引擎 › 详情；只改内存） */
export const demoEngineConfig: EngineConfig = { claude: demoLocal(), codex: demoLocal() }
