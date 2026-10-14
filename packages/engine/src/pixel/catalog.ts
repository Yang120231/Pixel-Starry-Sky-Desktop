// 像素星空命令行报上来的模型和思考强度（get_available_models / get_state）
import type { Effort, EngineCatalog, EngineModel } from '@pixelsky/protocol'
import { array, object, string, type Message, type PixelProcess } from './process'

/** 模型引用：provider/id（同一个 id 可能出现在多个 provider 下） */
export const modelRef = (model: Message): string => `${string(model.provider)}/${string(model.id)}`

/** 按 provider/id 找；只给 id 时取第一个同名的 */
export function findModel(models: Message[], ref: string): Message | undefined {
  return models.find(m => modelRef(m) === ref) ?? models.find(m => string(m.id) === ref)
}

const LEVELS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** 模型支持的强度，规则同 Pi 的 getSupportedThinkingLevels：不支持推理为空；xhigh / max 要模型明确映射才算支持 */
export function modelEfforts(model: Message): Effort[] {
  if (model.reasoning !== true) return []
  const map = object(model.thinkingLevelMap)
  return LEVELS.filter(level => {
    const mapped = map[level]
    if (mapped === null) return false
    return level === 'xhigh' || level === 'max' ? mapped !== undefined : true
  })
}

/** 我们的强度 → Pi 的思考级别（ultra 没有对应，按最高档） */
export const piThinkingLevel = (effort: Effort): string => (effort === 'ultra' ? 'max' : effort)

export function engineModel(model: Message, current: string | null): EngineModel {
  const ref = modelRef(model)
  return {
    id: ref,
    label: string(model.name) || string(model.id),
    efforts: modelEfforts(model),
    defaultEffort: null,
    inputModalities: array(model.input).map(string).filter(Boolean),
    isDefault: ref === current,
  }
}

/** 拉模型列表和当前模型；进程要已经启动 */
export async function pixelCatalog(proc: PixelProcess): Promise<{ catalog: EngineCatalog; raw: Message[] }> {
  const [list, state] = await Promise.all([proc.request('get_available_models'), proc.request('get_state')])
  const raw = array(list.data.models).map(object)
  const model = object(state.data.model)
  const current = string(model.id) ? modelRef(model) : null
  return {
    raw,
    catalog: {
      models: raw.map(m => engineModel(m, current)),
      currentModel: current,
      currentProvider: string(model.provider) || null,
      outputStyles: [],
      currentOutputStyle: null,
    },
  }
}
