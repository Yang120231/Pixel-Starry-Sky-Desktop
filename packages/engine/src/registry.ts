// 引擎描述 + 能力表：数据本体在 @pixelsky/protocol（packages/protocol/src/engines.ts），这里重新导出并放 unsupportedInfo
import type { EngineId, EngineInfo } from '@pixelsky/protocol'
import { ENGINES } from '@pixelsky/protocol'

export { ENGINES, ENGINE_ORDER } from '@pixelsky/protocol'
export type { EngineDescriptor } from '@pixelsky/protocol'

/** EngineInfo 里来自描述的部分（只取 id / name / short / caps，静态特征不随检测结果发给界面） */
export function engineBase(id: EngineId): Pick<EngineInfo, 'id' | 'name' | 'short' | 'caps'> {
  const d = ENGINES[id]
  return { id: d.id, name: d.name, short: d.short, caps: d.caps }
}

/** 还没接入的引擎：显示在菜单里，标「即将支持」 */
export function unsupportedInfo(id: EngineId): EngineInfo {
  return { ...engineBase(id), status: 'unsupported', version: null, path: null, message: '即将支持' }
}
