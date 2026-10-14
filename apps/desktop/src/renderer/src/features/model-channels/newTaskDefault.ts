// 新任务默认（docs/ui/model-channels.md §2.6）：通道的选择 ↔ 现有存储（默认引擎 + 这个引擎的来源 / 模型 / 线路 / 接口）
import type { EngineId } from '@pixelsky/protocol'
import { getPlatformState, setDefaultCustom, setDefaultModel, setDefaultSelfModel } from '@/features/account/platform'
import { getProviders, resolveCustomModel } from '@/features/account/providers'
import { bridge, getEngineState } from '@/features/engine/store'
import { channelOf, type ChannelChoice } from './channelModel'
import { setNewTaskDefault } from './channelPrefs'

/** 把一个选择写进这个引擎的默认来源和模型（不改默认引擎） */
export function writeChoiceDefault(c: ChannelChoice): void {
  if (c.channel === 'platform' && c.model) setDefaultModel(c.model, c.engine)
  else if (c.channel === 'custom' && c.providerId) setDefaultCustom(c.providerId, c.model, c.engine)
  else setDefaultSelfModel(c.model, c.engine)
}

/** 新任务默认整个换成这个选择：来源和模型，再加默认引擎 */
export function rememberNewTask(c: ChannelChoice): void {
  writeChoiceDefault(c)
  if (bridge && c.engine !== getEngineState().defaults?.engine)
    void bridge.setDefaultEngine(c.engine).catch(() => undefined)
}

/** 现在新任务会用什么（默认引擎 + 它的默认来源 / 模型） */
export function currentNewTaskChoice(engine: EngineId): ChannelChoice {
  const p = getPlatformState(engine)
  const channel = channelOf(engine, p.source)
  if (p.source === 'platform') return { channel, engine, model: p.model, providerId: null }
  if (p.source === 'custom') {
    const provider = getProviders().providers.find(x => x.id === p.providerId)
    return { channel, engine, model: resolveCustomModel(provider, p.customModel), providerId: p.providerId }
  }
  return { channel, engine, model: p.selfModel, providerId: null }
}

/** 设置里「新对话用」：固定为某个选择，或者回到接着上次 */
export function pinNewTask(choice: ChannelChoice | null): void {
  if (!choice) {
    setNewTaskDefault({ mode: 'last' })
    return
  }
  setNewTaskDefault({ mode: 'fixed', choice })
  rememberNewTask(choice)
}
