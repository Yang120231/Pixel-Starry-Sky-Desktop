// 侧栏对话的额外状态（工作文件夹还在不在、关联的 PR）：主进程 sessionStatus 服务算好推来，这里存一份给所有行共用。
// 窗口获得焦点时的刷新由主进程做，这里不重复。演示模式用演示数据。
import { useSyncExternalStore } from 'react'
import type { SessionStatusState } from '../../../../shared/types/session-status'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'

export const EMPTY_SESSION_STATUS: SessionStatusState = { missingFolders: {}, prs: {}, gh: 'missing' }

let state: SessionStatusState = EMPTY_SESSION_STATUS
let started = false
const listeners = new Set<() => void>()

const set = (value: SessionStatusState): void => {
  state = value
  listeners.forEach(fn => fn())
}

function start(): void {
  if (started) return
  started = true
  if (isDemo) {
    state = demo().sessionStatus ?? EMPTY_SESSION_STATUS
    return
  }
  const bridge = window.pixelsky?.sessionStatus
  if (!bridge) return
  bridge.onChange(set)
  void bridge.get().then(set, () => undefined)
}

function subscribe(callback: () => void): () => void {
  start()
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function useSessionStatus(): SessionStatusState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY_SESSION_STATUS,
  )
}

/** 悬停卡里点「刷新」：立刻重查这个对话（演示里没有主进程，什么也不做） */
export async function refreshSessionStatus(sessionId?: string): Promise<void> {
  if (isDemo) return
  await window.pixelsky?.sessionStatus?.refresh(sessionId)
}
