// 工作区的 Git 摘要（分支、未提交的改动数），给顶栏和新任务起点用（docs/ui/workbench-ux-3.md §2.1）；
// 完整状态给输入框上方的 Git 那几项用（docs/ui/composer-git.md）。
// 只读有人在用的工作区；窗口回到前台、项目工具变化、一轮结束或改了文件时重读（去抖），不定时轮询。
// Git 页读到的状态也写进来，在 Git 页切换分支后顶栏马上跟着变。
import { useEffect, useSyncExternalStore } from 'react'
import { isDemo } from '@/data'
import { demo as demoData } from '@/data/demo'
import { keyRef, refKey } from '@/features/editor/target'
import type { GitStatus } from '../../../../../shared/types/project-tools'
import { summarize, type GitSummary } from './summarize'
import { demoApply } from './demoGit'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'

const cache = new Map<string, GitSummary | null>()
const statuses = new Map<string, GitStatus>()
const users = new Map<string, { ref: WorkspaceRef; count: number }>()
const loading = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version++
  listeners.forEach(l => l())
}

/** Git 页读到状态时调用 */
export function publishGitStatus(ref: WorkspaceRef, status: GitStatus): void {
  const key = refKey(ref)
  if (JSON.stringify(statuses.get(key)) === JSON.stringify(status)) return
  statuses.set(key, status)
  cache.set(key, summarize(status))
  changed()
}

// 演示模式：输入框上方的提交、拉取、推送在内存里改这一份（GitPanel 的演示状态各管各的）
let demoStatus: GitStatus | null = null
const demoGit = (): GitStatus => (demoStatus ??= structuredClone(demoData().git.status))
export function applyDemoGit(action: string, arg?: unknown): void {
  demoStatus = demoApply(demoGit(), action, arg)
  changed()
}

async function load(ref: WorkspaceRef): Promise<void> {
  const api = window.pixelsky?.projectTools
  const key = refKey(ref)
  if (!api || loading.has(key)) return
  loading.add(key)
  try {
    publishGitStatus(ref, await api.gitStatus(ref))
  } catch {
    // 读不到（不是 Git 仓库、远端断开）：保留上次的
  } finally {
    loading.delete(key)
  }
}

let timer = 0
let stop: (() => void) | null = null

function reloadSoon(): void {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => users.forEach(u => void load(u.ref)), 400)
}

/** 有人在用时才挂监听 */
function watch(): void {
  const bridge = window.pixelsky
  if (stop || !bridge?.projectTools) return
  const offTools = bridge.projectTools.onChange(reloadSoon)
  const offWindow = bridge.window.onState(state => {
    if (state.focused) reloadSoon()
  })
  const offEngine = bridge.engine.onEvent(e => {
    if (
      e.kind === 'session' &&
      (e.event.type === 'turn_completed' || (e.event.type === 'item_completed' && e.event.item.kind === 'file_change'))
    )
      reloadSoon()
  })
  stop = () => {
    offTools()
    offWindow()
    offEngine()
    window.clearTimeout(timer)
    stop = null
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGitSummary(ref: WorkspaceRef | null): GitSummary | null {
  const key = useWatched(ref)
  if (isDemo) return ref ? summarize(demoGit()) : null
  return key ? (cache.get(key) ?? null) : null
}

/** 最近读到的完整状态；还没读到、不是 Git 仓库时是 null（不是仓库时 status.repo 为 false） */
export function useGitStatus(ref: WorkspaceRef | null): GitStatus | null {
  const key = useWatched(ref)
  if (isDemo) return ref ? demoGit() : null
  return key ? (statuses.get(key) ?? null) : null
}

/** 有人在看这个工作区：登记、挂监听、先读一次 */
function useWatched(ref: WorkspaceRef | null): string | null {
  const key = ref ? refKey(ref) : null
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    if (!key || isDemo) return
    const target = keyRef(key)
    const user = users.get(key)
    if (user) user.count++
    else users.set(key, { ref: target, count: 1 })
    watch()
    void load(target)
    return () => {
      const u = users.get(key)
      if (u && --u.count === 0) users.delete(key)
      if (users.size === 0) stop?.()
    }
  }, [key])
  return key
}
