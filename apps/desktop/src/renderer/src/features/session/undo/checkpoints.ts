// 对话检查点（docs/ui/undo-changes.md）：会话视图取一次检查点列表，改动卡片和检查点面板共用。
// 主进程不推送变化：会话状态、条目数变了，或者自己撤回 / 恢复之后重新取
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CheckpointList, RevertFilesResult, SessionSnapshot } from '@pixelsky/protocol'
import { isDemo } from '@/data/demo'
import { bridge } from '@/features/engine'
import { useComposerDraft } from '@/features/engine/drafts'

export interface CheckpointsValue {
  sessionId: string
  /** 还没取到时为 null */
  list: CheckpointList | null
  /** 任务在运行：不能撤回 / 回退 */
  busy: boolean
  refresh: () => void
  revert: (itemId: string, paths: string[], force: boolean) => Promise<RevertFilesResult>
  restore: (revertId: string, paths?: string[]) => Promise<void>
}

export const CheckpointsContext = createContext<CheckpointsValue | null>(null)

export const useCheckpoints = (): CheckpointsValue | null => useContext(CheckpointsContext)

/**
 * 输入框里有了文字：让主进程先拍第一次快照（还没拍过才拍，docs/ui/undo-changes.md §2），发消息时不用等它算整个工作目录。
 * 单独一个组件订阅草稿，免得每敲一个字整个会话视图都重新渲染
 */
export function CheckpointWarmup({ sessionId, draftKey }: { sessionId: string; draftKey: string }): null {
  const [draft] = useComposerDraft(draftKey)
  const typing = draft.trim().length > 0
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (!typing || !bridge || asked.current === sessionId) return
    asked.current = sessionId
    void bridge.prepareCheckpoints(sessionId).catch(() => undefined)
  }, [typing, sessionId])
  return null
}

/** 演示模式：每条我方消息都有快照，撤回只记在内存里，不动文件 */
function demoList(snapshot: SessionSnapshot, reverted: CheckpointList['reverted']): CheckpointList {
  const turns: CheckpointList['turns'] = []
  let current: { itemId: string; files: Set<string>; at: number } | null = null
  const flush = (): void => {
    if (current) turns.push({ itemId: current.itemId, files: [...current.files], at: current.at })
  }
  for (const item of snapshot.items) {
    if (item.kind === 'user' && item.mode !== 'guidance') {
      flush()
      current = { itemId: item.id, files: new Set(), at: item.createdAt ?? Date.now() }
    } else if (item.kind === 'file_change' && current) for (const c of item.changes) current.files.add(c.path)
  }
  flush()
  return { disabled: null, turns, reverted }
}

export function useCheckpointsState(
  sessionId: string | null,
  snapshot: SessionSnapshot | null,
): CheckpointsValue | null {
  const [list, setList] = useState<CheckpointList | null>(null)
  const [tick, setTick] = useState(0)
  const [demoReverted, setDemoReverted] = useState<CheckpointList['reverted']>([])
  const busy =
    !!snapshot &&
    (snapshot.state !== 'idle' || snapshot.queue.some(q => ['dispatching', 'running', 'delivering'].includes(q.status)))
  const state = snapshot?.state
  // 运行中不取：快照只在一轮开始、结束时变；空闲时条目数变了（回退、撤销回退）再取
  const idleCount = state === 'idle' ? (snapshot?.items.length ?? 0) : -1
  useEffect(() => {
    setList(null)
    setDemoReverted([])
  }, [sessionId])
  // 回来时核对还是不是发起时的会话
  const current = useRef(sessionId)
  current.current = sessionId
  useEffect(() => {
    if (!bridge || !sessionId || idleCount < 0) return
    let alive = true
    // 一轮刚结束时结束快照还在拍：稍等一下再取
    const timer = setTimeout(
      () =>
        void bridge!
          .checkpoints(sessionId)
          .then(next => {
            if (!alive || current.current !== sessionId) return
            // 内容没变就不换对象：改动卡片和消息操作都订阅它
            setList(prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
          })
          .catch(() => undefined),
      500,
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sessionId, idleCount, tick])
  const refresh = useCallback(() => setTick(n => n + 1), [])
  const demo = isDemo && !bridge && snapshot ? snapshot : null
  const shown = useMemo(() => (demo ? demoList(demo, demoReverted) : list), [demo, demoReverted, list])
  return useMemo(() => {
    if (!sessionId || (!bridge && !isDemo)) return null
    return {
      sessionId,
      list: shown,
      busy,
      refresh,
      revert: async (itemId, paths, force) => {
        if (!bridge) {
          const revertId = `demo-${Date.now()}`
          setDemoReverted(prev => [...prev, { revertId, itemId, paths }])
          return { kind: 'done', revertId, reverted: paths, skipped: [] }
        }
        try {
          return await bridge.revertFiles(sessionId, itemId, paths, force)
        } finally {
          refresh()
        }
      },
      restore: async (revertId, paths) => {
        if (!bridge) {
          setDemoReverted(prev =>
            prev.flatMap(r => {
              if (r.revertId !== revertId) return [r]
              const left = paths ? r.paths.filter(p => !paths.includes(p)) : []
              return left.length ? [{ ...r, paths: left }] : []
            }),
          )
          return
        }
        try {
          await bridge.restoreFiles(sessionId, revertId, paths)
        } finally {
          refresh()
        }
      },
    }
  }, [sessionId, shown, busy, refresh])
}
