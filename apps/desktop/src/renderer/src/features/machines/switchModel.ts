// 顶栏「本机 | 云端」的判断（docs/ui/layout-v2.md §4）：「云端」就是远程机器（SSH），本机 = id 为 local 的那台
import type { MachineInfo, MachineState } from '../../../../shared/types/machines'

export interface SwitchView {
  side: 'local' | 'cloud'
  /** 当前是云端时那台机器的名字 */
  name?: string
  /** 当前云端机器连不上（断开 / 出错 / 连接中），名字前画警告点 */
  warn: boolean
}

/** 能直接用的机器：本机或已连接 */
export const usableMachine = (m: Pick<MachineInfo, 'status'>): boolean =>
  m.status === 'local' || m.status === 'connected'

export const cloudMachines = (state: MachineState): MachineInfo[] => state.machines.filter(m => m.id !== 'local')

export function switchView(state: MachineState): SwitchView {
  const current = state.machines.find(m => m.id === state.currentId)
  if (!current || current.id === 'local') return { side: 'local', warn: false }
  return { side: 'cloud', name: current.name, warn: !usableMachine(current) }
}
