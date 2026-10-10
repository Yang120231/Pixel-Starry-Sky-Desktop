import type { EngineHost } from '@pixelsky/engine'
import type { ProjectTools } from '../core/project-tools/tools'
import type { Machines } from '../machines/service'
import type { ProviderStore } from '../core/providers/store'
import { EventBus } from './events'
import { Lifecycle } from './lifecycle'

/**
 * 主进程各模块共用的状态，由 index.ts 创建后按初始化顺序传下去（取代原来模块之间的 `export let` 接线）。
 * 后三项在对应模块初始化之后才有值；初始化之前收到的调用按原来的方式处理（多数报「项目尚未加载」或走本机）。
 */
export interface AppContext {
  readonly events: EventBus
  readonly lifecycle: Lifecycle
  /** 本机引擎宿主（engine/ipc.ts 的 initEngine） */
  engine: EngineHost | null
  /** SSH 机器（machines/service.ts 的 initMachines，在 initEngine 里） */
  machines: Machines | null
  /** 项目工具（workspace/project-tools-ipc.ts 的 initProjectTools） */
  projectTools: ProjectTools | null
  /** 自定义 API 的接口配置（providers/providers.ts 的 initProviders，在 initEngine 里） */
  providers: ProviderStore | null
}

export function createAppContext(): AppContext {
  return {
    events: new EventBus(),
    lifecycle: new Lifecycle(),
    engine: null,
    machines: null,
    projectTools: null,
    providers: null,
  }
}

/** 当前选中的机器（'local' 或 SSH 机器 ID） */
export function selectedMachine(ctx: AppContext): string {
  return ctx.machines?.currentId ?? 'local'
}
