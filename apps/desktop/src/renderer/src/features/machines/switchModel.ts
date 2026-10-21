// 顶栏「本机 | 云端」的判断（docs/ui/layout-v2.md §4）：「云端」就是远程机器（SSH）；本机 = id 为 local 的那台，WSL 发行版也算本机这一边
import { ENGINES } from '@pixelsky/protocol'
import type { CheckItem, MachineInfo, MachineState } from '../../../../shared/types/machines'

export interface SwitchView {
  side: 'local' | 'cloud'
  /** 当前是云端（SSH）或某个 WSL 发行版时那台机器的名字（WSL 的名字只放在「本机」那半） */
  name?: string
  /** 当前云端机器连不上（断开 / 出错 / 连接中），名字前画警告点 */
  warn: boolean
}

/** 能直接用的机器：本机或已连接 */
export const usableMachine = (m: Pick<MachineInfo, 'status'>): boolean =>
  m.status === 'local' || m.status === 'connected'

export const cloudMachines = (state: MachineState): MachineInfo[] => state.machines.filter(m => m.kind === 'ssh')

export function switchView(state: MachineState): SwitchView {
  const current = state.machines.find(m => m.id === state.currentId)
  if (!current || current.id === 'local') return { side: 'local', warn: false }
  if (current.kind === 'wsl') return { side: 'local', name: current.name, warn: !usableMachine(current) }
  return { side: 'cloud', name: current.name, warn: !usableMachine(current) }
}

export const wslMachines = (state: MachineState): MachineInfo[] => state.machines.filter(m => m.kind === 'wsl')

export interface WslStatusLine {
  tone: 'ok' | 'idle' | 'warn' | 'busy'
  /** wslMessages 的 key；params.problem 是另一个 wsl.problem.* key，params.code 是要翻译的错误码，都由界面翻译 */
  key: string
  params?: Record<string, string>
  /** 上次检查有必需项没过：右侧画「需要准备」 */
  needsPrep: boolean
}

/** 必需项里第一个没过的（没有就是 undefined） */
export const firstFailedRequired = (items: CheckItem[] | undefined): CheckItem | undefined =>
  items?.find(i => i.required && i.status !== 'ok')

const PROBLEM_CODES = ['NODE_MISSING', 'NODE_OLD', 'NODE_BROKEN', 'NODE_WINDOWS']
const problemKey = (item: CheckItem): string =>
  item.code && PROBLEM_CODES.includes(item.code) ? `wsl.problem.${item.code}` : `wsl.problem.${item.key}`

/**
 * 已连接的发行版里能用的引擎：Claude Code / Codex 带版本（检查项 detail 是「版本 (路径)」，版本号取前两段，
 * 路径里的数字不算；读不到版本只写名字），自带的像素星空引擎检查通过就列名字（版本跟着桌面端）
 */
export function wslEngines(items: CheckItem[] | undefined): string[] {
  const ok = (key: CheckItem['key']) => items?.find(i => i.key === key && i.status === 'ok')
  const list: string[] = []
  for (const key of ['claude', 'codex'] as const) {
    const item = ok(key)
    if (!item) continue
    const version = item.detail.split(' (')[0].match(/\d+\.\d+/)?.[0]
    list.push(version ? `${ENGINES[key].name} ${version}` : ENGINES[key].name)
  }
  if (ok('pixel')) list.push(ENGINES.pixel.name)
  return list
}

/** 菜单里发行版那行的状态：只读已有记录，不为了显示去启动 WSL（wsl-mode.plan.md §3.1） */
export function wslStatusLine(m: MachineInfo): WslStatusLine {
  if (m.status === 'connected') {
    const engines = wslEngines(m.wsl?.lastCheck?.items)
    return engines.length
      ? {
          tone: 'ok',
          key: 'wsl.status.connectedVersion',
          params: { version: engines.join(' · ') },
          needsPrep: false,
        }
      : { tone: 'ok', key: 'wsl.status.connected', needsPrep: false }
  }
  if (m.status === 'connecting') return { tone: 'busy', key: 'wsl.status.connecting', needsPrep: false }
  if (m.status === 'error' && m.error && m.error !== 'WSL_NOT_READY')
    return { tone: 'warn', key: 'wsl.status.error', params: { code: m.error }, needsPrep: false }
  const running = m.wsl?.state === 'running',
    check = m.wsl?.lastCheck
  if (!check)
    return { tone: 'idle', key: running ? 'wsl.status.runningNever' : 'wsl.status.stoppedNever', needsPrep: false }
  const failed = firstFailedRequired(check.items)
  if (failed)
    return {
      tone: 'idle',
      key: running ? 'wsl.status.runningFailed' : 'wsl.status.stoppedFailed',
      params: { problem: problemKey(failed) },
      needsPrep: true,
    }
  return running
    ? { tone: 'ok', key: 'wsl.status.runningOk', needsPrep: false }
    : { tone: 'idle', key: 'wsl.status.stoppedOk', needsPrep: false }
}
