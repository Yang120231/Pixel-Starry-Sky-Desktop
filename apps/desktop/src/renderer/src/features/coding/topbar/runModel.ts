// 顶栏「运行」胶囊的纯逻辑：挑主服务、按状态给出可用操作
export type RunStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'

export interface RunActions {
  start: boolean
  stop: boolean
  restart: boolean
}

/** 优先运行中的，其次 starting，否则第一个；空列表返回 null */
export function primaryService<T extends { status: RunStatus }>(list: readonly T[]): T | null {
  return list.find(s => s.status === 'running') ?? list.find(s => s.status === 'starting') ?? list[0] ?? null
}

/** stopped / failed 能 start；running 能 stop 和 restart；starting / stopping 都不能点 */
export function serviceActions(status: RunStatus): RunActions {
  switch (status) {
    case 'stopped':
    case 'failed':
      return { start: true, stop: false, restart: false }
    case 'running':
      return { start: false, stop: true, restart: true }
    default:
      return { start: false, stop: false, restart: false }
  }
}
