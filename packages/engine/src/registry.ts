// 引擎描述 + 能力表（docs/engines.md §4）
import type { EngineCaps, EngineId, EngineInfo } from '@pixelsky/protocol'

export interface EngineDescriptor {
  id: EngineId
  name: string
  short: string
  caps: EngineCaps
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
    },
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
    },
  },
}

export const ENGINE_ORDER: readonly EngineId[] = ['claude', 'codex']

/** 还没接入的引擎：显示在菜单里，标「即将支持」 */
export function unsupportedInfo(id: EngineId): EngineInfo {
  const d = ENGINES[id]
  return { ...d, status: 'unsupported', version: null, path: null, message: '即将支持' }
}
