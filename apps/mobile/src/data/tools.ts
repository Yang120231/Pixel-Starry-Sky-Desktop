// 工具（docs/mobile-remote.md §18.4）：Git、文件、产物、任务。经网关调电脑上和工具面板同一套操作，
// 第一个参数是项目，只在项目所在的那台机器上跑。类型是电脑端的子集（手机不导入电脑端的代码）。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TodoStep } from '@pixelsky/protocol'
import { connections } from '@/connection'
import { useLinkState } from './hooks'

export type ToolId = 'git' | 'files' | 'artifacts' | 'tasks'

export const TOOL_NAMES: Record<ToolId, string> = { git: 'Git', files: '文件', artifacts: '产物', tasks: '任务' }

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type GitArea = 'staged' | 'unstaged' | 'untracked' | 'conflicted'
export type GitCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

export interface GitFileChange {
  /** 相对仓库根目录 */
  path: string
  origPath: string | null
  code: GitCode
  submodule: boolean
}

export interface GitStatus {
  repo: boolean
  missing: boolean
  branch: string | null
  detached: boolean
  initial: boolean
  upstream: string | null
  ahead: number
  behind: number
  remotes: string[]
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
  truncated: boolean
  operation: string | null
  busySessions: number
}

export interface GitFailure {
  kind: string
  action: string
  detail: string
}

export type GitResult = { ok: true; status: GitStatus } | { ok: false; failure: GitFailure; status: GitStatus | null }

/** 电脑比好的改动（只有改动和前后几行） */
export interface GitDiffView {
  path: string
  binary: boolean
  tooLarge: boolean
  diff: string
  added: number
  removed: number
  cut: boolean
}

export interface FileEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
  /** Git 状态（M、A、?…） */
  status?: string
}

export interface DirectoryListing {
  entries: FileEntry[]
  truncated: boolean
}

export type FileDocument =
  | { kind: 'text'; path: string; content: string; bytes: number; cut?: boolean }
  | { kind: 'image'; path: string; dataUrl: string; bytes: number }
  | { kind: 'unsupported'; path: string; reason: string; bytes: number }

/** review = 待验收：交给 AI 成员的事项做完了，等你验收（桌面端 docs/ui/channels-collab-v2.md §9） */
export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed'

export interface ManualTask {
  id: string
  projectId: string
  title: string
  note: string
  status: TaskStatus
  priority: 'low' | 'normal' | 'high'
  due: string
  createdAt: number
  updatedAt: number
  completedAt?: number | null
}

export interface AiPlan {
  sessionId: string
  title: string
  item: { id: string; steps: TodoStep[] }
}

export interface TaskState {
  tasks: ManualTask[]
  plans: AiPlan[]
}

export interface DirectoryChoices {
  path: string
  parent: string | null
  directories: string[]
}

// ---------------------------------------------------------------------------
// 文字
// ---------------------------------------------------------------------------

/** 出错时给人看的话 */
export function toolError(e: unknown): string {
  const message = (e as Error)?.message ?? String(e)
  if (message.includes('MOBILE_UNSUPPORTED')) return '电脑上的像素星空版本较旧，更新后才能在手机上用这个功能。'
  if (message.includes('MOBILE_FORBIDDEN')) return '这部手机是「只看」，在电脑上 设置 › 手机 里改成「可操作」才能做。'
  if (message.includes('MOBILE_TOO_LARGE')) return '内容太大，请到电脑上看。'
  if (message.includes('MOBILE_BAD_ARGUMENT')) return '参数不对，刷新后再试。'
  if (message.includes('MOBILE_DISCONNECTED') || message.includes('LINK_')) return '和电脑的连接断了，恢复后再试。'
  return message
}

const GIT_FAILURES: Record<string, string> = {
  diverged: '本地和远端已分叉，请到电脑上处理。',
  rejected: '远端有本地还没拉取的提交：请先在电脑上拉取，再推送。',
  conflict: '有没解决的冲突，请到电脑上处理。',
  auth: '远端拒绝了访问：请在电脑的终端里登录或配置凭据后重试。',
  network: '连不上远端，检查电脑的网络或代理后重试。',
  timeout: '远端没有及时响应，已结束这次操作。',
  locked: '另一个 git 进程正在使用这个仓库，等它结束后重试。',
  hook: '仓库的 git hook 拒绝了这次操作。',
  noUpstream: '当前分支还没有上游分支：推送时会发布到远端。',
  noRemote: '这个仓库没有配置远端。',
  identity: '电脑上没有设置提交用户名和邮箱（git config user.name / user.email）。',
  nothing: '没有可以提交的内容：先暂存文件，或选「提交全部改动」。',
  busy: 'AI 正在这个工作区运行，等它这一轮结束再试。',
  missing: '电脑上没有找到 Git。',
  notRepo: '这个项目不是 Git 仓库。',
}

/** Git 操作失败的说明（hook 的输出接在后面） */
export function gitFailureText(f: GitFailure): string {
  const text = GIT_FAILURES[f.kind] ?? '操作失败'
  const detail = f.detail.trim().split('\n').slice(-6).join('\n')
  return f.kind === 'hook' || !GIT_FAILURES[f.kind] ? (detail ? `${text}\n${detail}` : text) : text
}

export const GIT_CODE_TEXT: Record<GitCode, string> = {
  M: '修改',
  A: '新增',
  D: '删除',
  R: '改名',
  C: '复制',
  T: '类型',
  U: '冲突',
  '?': '未跟踪',
}

/** 所有改动的文件数 */
export const gitChangeCount = (s: GitStatus): number =>
  s.staged.length + s.unstaged.length + s.untracked.length + s.conflicted.length

/** 文件大小：1.2 KB */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// 调用
// ---------------------------------------------------------------------------

/** 调一次电脑上的工具（连上了才行） */
export function callTool<T>(deviceId: string, method: string, ...args: unknown[]): Promise<T> {
  const link = connections.link(deviceId)
  if (!link || connections.state(deviceId) !== 'ready') return Promise.reject(new Error('还没连上电脑'))
  return link.call<T>(method, ...args)
}

export interface ToolData<T> {
  data: T | null
  /** 取到过（data 为 null 也算：电脑说没有） */
  loaded: boolean
  error: string | null
  loading: boolean
  reload(): void
  /** 写操作直接返回了新状态时（Git 的结果带着最新状态）用它，不用再取一次 */
  set(data: T): void
}

/**
 * 取一次工具数据：连上 / 重连、参数变了、点刷新时重取；watch 时电脑上任务或 Git 变了也重取（停 300 毫秒合并）。
 * method 为 null 时不取。
 */
export function useToolData<T>(
  deviceId: string,
  method: string | null,
  args: readonly unknown[],
  watch = false,
): ToolData<T> {
  const state = useLinkState(deviceId)
  const [data, setData] = useState<T | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const key = JSON.stringify(args)
  const argsRef = useRef(args)
  argsRef.current = args
  useEffect(() => {
    setData(null)
    setLoaded(false)
    setError(null)
  }, [method, key])
  useEffect(() => {
    if (!method || state !== 'ready') return
    let alive = true
    setLoading(true)
    callTool<T>(deviceId, method, ...argsRef.current).then(
      r => {
        if (!alive) return
        setData(r)
        setLoaded(true)
        setError(null)
        setLoading(false)
      },
      e => {
        if (!alive) return
        setError(toolError(e))
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [deviceId, method, key, state, nonce])
  useEffect(() => {
    if (!watch || !method) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const listener = (id: string, event: unknown) => {
      if (id !== deviceId || (event as { kind?: string } | null)?.kind !== 'tools') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setNonce(n => n + 1), 300)
    }
    connections.eventListeners.add(listener)
    return () => {
      connections.eventListeners.delete(listener)
      if (timer) clearTimeout(timer)
    }
  }, [deviceId, method, watch])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { data, loaded, error, loading, reload, set: setData }
}
