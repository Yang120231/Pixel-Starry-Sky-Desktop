// 云端 / 本机模型的上下文窗口（GitHub #20，docs/ui/context-settings-branch-switch.md §2）：存在引擎设置里，
// 每个引擎一份；主进程校验后广播 engine_config，store 跟着更新。演示模式只在内存里
import { useSyncExternalStore } from 'react'
import type { ContextWindows, EngineConfigPatch, EngineId, SessionRecord } from '@pixelsky/protocol'
import { bridge, isLive, useEngineState } from '@/features/engine'
import { demo, isDemo } from '@/data/demo'
import { openEngineDetail } from '../engines/nav'
import { requestModelsScroll } from './scroll'

export type WindowSource = keyof ContextWindows

const EMPTY: ContextWindows = { platform: {}, self: {} }

/** 按模型合并：null 删掉这个模型的设置（和主进程的规则一样） */
export function mergeContextWindows(
  current: ContextWindows,
  patch: NonNullable<EngineConfigPatch['contextWindows']>,
): ContextWindows {
  const next: ContextWindows = { platform: { ...current.platform }, self: { ...current.self } }
  for (const source of ['platform', 'self'] as const)
    for (const [model, n] of Object.entries(patch[source] ?? {})) {
      if (n === null) delete next[source][model]
      else next[source][model] = n
    }
  return next
}

// 演示模式
let demoWindows: Partial<Record<EngineId, ContextWindows>> = {}
const listeners = new Set<() => void>()

export function useContextWindows(engine: EngineId): ContextWindows {
  const live = useEngineState(s => s.config?.[engine]?.contextWindows)
  const local = useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => demoWindows[engine],
  )
  if (isLive) return live ?? EMPTY
  return local ?? (isDemo ? (demo().engines.config[engine]?.contextWindows ?? EMPTY) : EMPTY)
}

/** 改一个模型的窗口；null 是清空（用引擎自己知道的） */
export async function setContextWindow(
  engine: EngineId,
  source: WindowSource,
  model: string,
  value: number | null,
): Promise<void> {
  const patch = { [source]: { [model]: value } }
  if (bridge) {
    await bridge.setConfig(engine, { contextWindows: patch })
    return
  }
  const current = demoWindows[engine] ?? (isDemo ? demo().engines.config[engine]?.contextWindows : null) ?? EMPTY
  demoWindows = { ...demoWindows, [engine]: mergeContextWindows(current, patch) }
  listeners.forEach(fn => fn())
}

/**
 * 上下文按钮里的「上下文设置…」：云端会话到模型与额度的模型列表，本机会话到这个引擎的详情，
 * 自定义 API 会话到模型与额度（自定义 API 在同一页）；还没有会话时按本机引擎 Claude Code
 */
export function openContextSettings(
  record: Pick<SessionRecord, 'engine' | 'platform' | 'provider'> | null,
  open: (section: 'models' | 'engines') => void,
): void {
  if (record?.platform) {
    requestModelsScroll()
    open('models')
  } else if (record?.provider) open('models')
  else {
    openEngineDetail(record?.engine ?? 'claude')
    open('engines')
  }
}
