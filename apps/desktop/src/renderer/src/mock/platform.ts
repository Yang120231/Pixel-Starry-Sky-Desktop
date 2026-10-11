// 演示模式下的平台目录（--demo）。真实目录来自适配层 /v1/platform/groups（docs/ui/platform-groups.md）
import type { EngineCatalog, EngineConfig, EngineLocalConfig } from '@pixelsky/protocol'
import type { EngineLite } from '@/data/types'
import type { PlatformGroupInfo } from '../../../shared/types/platform-catalog'
import type { ProvidersState } from '../../../shared/types/providers'

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

/** 演示模式下本机引擎的检测结果（设置 › 本机引擎） */
export const demoEngineStatus: EngineLite[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    status: 'ready',
    version: '2.1.291',
    // 演示「有新版本」提示（docs/ui/engine-update.md）
    latestVersion: '2.1.300',
    message: null,
    path: 'C:\\Users\\linxia\\.local\\bin\\claude.exe',
    caps: {
      permissionModes: ['ask', 'edits', 'plan', 'full'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      ultracode: true,
      fast: true,
      thinkingSummaries: true,
      selfUpdate: true,
      launchSettings: true,
      pluginCommands: true,
      platformSwitch: true,
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
      selfUpdate: false,
      launchSettings: false,
      pluginCommands: false,
      platformSwitch: false,
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
  args: [],
  env: {},
  compactModel: null,
  defaults: {
    model: null,
    effort: 'high',
    permissionMode: 'edits',
    ultracode: false,
    fast: false,
    thinkingSummaries: true,
  },
  outputStyle: null,
  askQuestions: true,
  autoCompactPct: null,
  hidden: false,
})

/** 演示模式下本机引擎的配置（设置 › 本机引擎 › 详情；只改内存） */
export const demoEngineConfig: EngineConfig = { claude: demoLocal(), codex: demoLocal() }

/** 演示用的两条自定义 API（docs/ui/custom-api.md §5 A4） */
export const demoProviders: ProvidersState = {
  persistent: true,
  warning: null,
  providers: [
    {
      id: 'demo-deepseek',
      name: 'DeepSeek 兼容',
      template: 'custom',
      protocol: 'anthropic',
      baseUrl: 'https://api.example.com/anthropic',
      auth: 'x-api-key',
      models: [{ id: 'deepseek-chat', priceRef: 'claude-haiku-4-5' }, { id: 'deepseek-reasoner' }],
      smallModel: 'deepseek-chat',
      modelFallback: true,
      keyHint: 'a1b2',
      headerNames: [],
      insecure: false,
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
    },
    {
      id: 'demo-gateway',
      name: '公司网关',
      template: 'custom',
      protocol: 'responses',
      baseUrl: 'http://192.168.1.20:8080/v1',
      auth: 'bearer',
      models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }],
      smallModel: null,
      modelFallback: true,
      keyHint: '9f3c',
      headerNames: ['X-Org'],
      insecure: true,
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
    },
  ],
}
