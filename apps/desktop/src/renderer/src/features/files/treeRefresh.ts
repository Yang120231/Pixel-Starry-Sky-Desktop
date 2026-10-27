// 文件树自动刷新（docs/ui/file-tree-auto-refresh.md）：三棵树共用的刷新时机（§2 A），本机目录监听推来的变化怎么用（§2 B）
import { useEffect, useRef, useState } from 'react'
import { bridge, useSession } from '@/features/engine'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { planTreeChange } from './treeChange'

const FOCUS_THROTTLE_MS = 10_000
const FILE_CHANGE_DEBOUNCE_MS = 500
/** 监听引起的 Git 状态重读最多这么久一次（每次 3 个 git 进程） */
const STATUS_THROTTLE_MS = 2000

/**
 * 刷新键：会话离开「运行中」、AI 改完文件（500ms 防抖）、切回窗口（10 秒内一次）、树从隐藏变成看得见时加 1。
 * 看不见时这些都不算（切回来那一下会刷新）。没有会话（项目目标）时只按焦点和可见性：本机的有目录监听
 */
export function useTreeRefresh(sessionId: string | null | undefined, visible: boolean): number {
  const [key, setKey] = useState(0)
  const bump = (): void => setKey(k => k + 1)
  const state = useSession(sessionId ?? null)?.state
  const previous = useRef(state)
  useEffect(() => {
    if (previous.current === 'running' && state !== 'running' && visible) bump()
    previous.current = state
  }, [state])
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current) bump()
    wasVisible.current = visible
  }, [visible])
  // 切回窗口时刷新，但 10 秒内只刷一次：每次 Alt-Tab 都整棵重读、跑好几条 git（docs/perf-audit-2026-10-18.md B5）
  const lastFocus = useRef(0)
  useEffect(() => {
    if (!visible) return
    const onFocus = (): void => {
      if (Date.now() - lastFocus.current < FOCUS_THROTTLE_MS) return
      lastFocus.current = Date.now()
      bump()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [visible])
  // AI 用编辑工具改完文件：一轮还没结束树里就能看到（shell 命令改的要等一轮结束）
  useEffect(() => {
    if (!visible || !bridge || !sessionId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = bridge.onEvent(e => {
      if (e.kind !== 'session' || e.sessionId !== sessionId) return
      if (e.event.type !== 'item_completed' || e.event.item.kind !== 'file_change') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(bump, FILE_CHANGE_DEBOUNCE_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [visible, sessionId])
  return key
}

const NO_TICKS: ReadonlyMap<string, number> = new Map()

/**
 * 项目根订阅本机目录监听：返回 rev（整棵重读时加 1）、ticks（每个文件夹被要求重读的次数，放进 Directory 的依赖）、
 * statusTick（节流后的 Git 状态重读）。on 为 false（看不见、没展开、演示）时不订阅
 */
export function useTreeWatch(
  ref: WorkspaceRef,
  on: boolean,
  ignored: ReadonlySet<string>,
  /** 附加文件夹的路径（换行连起来）：换了文件夹（数量不变也算）要重新订阅，主进程按订阅时的文件夹编前缀 */
  folderKey: string,
): { rev: number; ticks: ReadonlyMap<string, number>; statusTick: number } {
  const [rev, setRev] = useState(0),
    [ticks, setTicks] = useState(NO_TICKS),
    [statusTick, setStatusTick] = useState(0)
  const ignoredRef = useRef(ignored)
  ignoredRef.current = ignored
  const lastStatus = useRef(0)
  useEffect(() => {
    const files = window.pixelsky?.files
    if (!on || !files) return
    const prefixes = folderKey ? folderKey.split('\n').map((_, i) => `::${i + 1}`) : []
    let statusTimer: ReturnType<typeof setTimeout> | null = null
    const refreshStatus = (): void => {
      if (statusTimer) return
      const wait = lastStatus.current + STATUS_THROTTLE_MS - Date.now()
      const run = (): void => {
        statusTimer = null
        lastStatus.current = Date.now()
        setStatusTick(n => n + 1)
      }
      if (wait <= 0) run()
      else statusTimer = setTimeout(run, wait)
    }
    const off = files.watch(ref, change => {
      const plan = planTreeChange(change, ignoredRef.current, prefixes)
      if (plan.all) {
        setTicks(NO_TICKS)
        setRev(n => n + 1)
        return
      }
      if (plan.dirs.length)
        setTicks(prev => {
          const next = new Map(prev)
          for (const dir of plan.dirs) next.set(dir, (next.get(dir) ?? 0) + 1)
          return next
        })
      if (plan.status) refreshStatus()
    })
    return () => {
      off()
      if (statusTimer) clearTimeout(statusTimer)
    }
  }, [on, ref.projectId, ref.sessionId, ref.folder, folderKey])
  return { rev, ticks, statusTick }
}
