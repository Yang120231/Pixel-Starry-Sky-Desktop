// 设置 › 模型与额度按引擎分别设默认（docs/ui/engine-defaults.md）：某个引擎能选的模型、推理强度、能不能设置。纯函数
import type { Effort, EngineCatalog, EngineModel } from '@pixelsky/protocol'

/** 这个引擎这一页能不能设：装好了（已登录或没登录）才能设；没装、太旧、检测失败、暂不支持时只显示状态 */
export function engineConfigurable(status: string | undefined): boolean {
  return status === 'ready' || status === 'unauthenticated'
}

/** 「跟随引擎设置」实际是哪个模型：Codex 报 currentModel，Claude Code 没有就是 null */
export function followedModel(catalog: EngineCatalog | null): string | null {
  return catalog?.currentModel ?? catalog?.models?.find(m => m.isDefault)?.id ?? null
}

/**
 * 默认推理强度的档位：按这一页选的默认模型。
 * 目录里有这个模型且报了档位就用它的；没选模型（跟随引擎设置）时用引擎当前模型的；都没有时用引擎能力里的档位
 */
export function effortChoices(
  model: string | null,
  catalogModels: readonly EngineModel[] | undefined,
  followed: string | null,
  capsEfforts: readonly Effort[],
): Effort[] {
  const id = model ?? followed
  const found = id ? catalogModels?.find(m => m.id === id || m.resolved === id) : undefined
  return [...(found && found.efforts.length > 0 ? found.efforts : capsEfforts)]
}

/** 默认强度在新档位里还在不在；不在时回到「跟随引擎设置」（null），界面提示一句 */
export function keepEffort(effort: Effort | null, choices: readonly Effort[]): Effort | null {
  return effort && choices.includes(effort) ? effort : null
}
