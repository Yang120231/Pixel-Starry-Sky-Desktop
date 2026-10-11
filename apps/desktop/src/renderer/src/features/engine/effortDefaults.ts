// 推理强度那几项（推理强度、Ultracode、Fast、思考摘要）的默认值（GitHub #6，docs/ui/engine-settings-redesign.md §3.2）。纯函数
import {
  EFFORT_PANEL_FACTORY,
  type EffortPanelDefaults,
  type EngineConfig,
  type EngineDefaults,
  type EngineId,
} from '@pixelsky/protocol'

/**
 * 一个引擎自己的默认值：每个引擎各记一份，切换引擎时用切过去那个的。
 * 引擎配置还没读到时，默认引擎用宿主报的默认值，其余用出厂值。
 */
export function effortDefaultsFor(
  config: EngineConfig | null,
  defaults: EngineDefaults | null,
  engine: EngineId,
): EffortPanelDefaults {
  const d = config?.[engine]?.defaults ?? (defaults?.engine === engine ? defaults : null)
  if (!d) return EFFORT_PANEL_FACTORY
  return { effort: d.effort, ultracode: d.ultracode, fast: d.fast, thinkingSummaries: d.thinkingSummaries }
}

/** 当前值和默认值哪几项不一样；引擎不支持的开关、没有强度档位的模型不算 */
export function effortDiff(
  current: EffortPanelDefaults,
  defaults: EffortPanelDefaults,
  supported: { effort: boolean; ultracode: boolean; fast: boolean; thinkingSummaries: boolean },
): (keyof EffortPanelDefaults)[] {
  return (Object.keys(supported) as (keyof EffortPanelDefaults)[]).filter(
    k => supported[k] && current[k] !== defaults[k],
  )
}
