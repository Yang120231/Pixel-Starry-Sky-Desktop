// 界面崩溃后自动重新加载（docs/ui/renderer-memory.md §3.1）：10 分钟内第 1～3 次隔 1 / 2 / 5 秒重新加载，
// 第 4 次起弹系统对话框让用户选。只管主窗口；次数只记在内存里。
import { dialog, type BrowserWindow } from 'electron'
import { logger } from '@pixelsky/engine'
import { allMessages, type TranslationKey } from '../../shared/i18n/translate'
import type { Locale } from '../../shared/i18n/messages'
import { isRecovering, markRecovering } from './rendererHealth'
import { windowLocale } from './ui-language'

const log = logger('app')

/** 只数这么久以内的崩溃 */
export const WINDOW_MS = 600_000
/** 第 1～3 次崩溃后等多久重新加载 */
export const DELAYS = [1000, 2000, 5000]
/** 重新加载发出后这么久既没完成也没失败（开发服务器接受连接却不响应），当作加载失败 */
export const LOAD_TIMEOUT_MS = 30_000
/** ERR_ABORTED：被新的加载顶掉时也会报，不算失败 */
const ERR_ABORTED = -3

export type RecoveryAction = { kind: 'reload'; delayMs: number } | { kind: 'ask' }

/** 丢掉 10 分钟以前的记录，加上这次，按次数给出动作 */
export function recoveryStep(
  times: readonly number[],
  now: number,
): { times: number[]; n: number; action: RecoveryAction } {
  const kept = [...times.filter(t => now - t < WINDOW_MS), now]
  const delayMs = DELAYS[kept.length - 1]
  return { times: kept, n: kept.length, action: delayMs === undefined ? { kind: 'ask' } : { kind: 'reload', delayMs } }
}

// ---------------------------------------------------------------------------
// 加载页面
// ---------------------------------------------------------------------------

export interface LoadTarget {
  /** 开发模式：开发服务器的地址 */
  devUrl?: string
  /** 打包后：index.html 的路径 */
  file: string
}

/** 加载应用页面，query 带给界面（recovered、n）。rejection 只吞掉不记：同一次失败 did-fail-load 会记，免得记两遍 */
export function loadApp(win: BrowserWindow, target: LoadTarget, query?: Record<string, string>): Promise<void> {
  const loading = target.devUrl
    ? win.loadURL(
        query
          ? `${target.devUrl}${target.devUrl.includes('?') ? '&' : '?'}${new URLSearchParams(query)}`
          : target.devUrl,
      )
    : win.loadFile(target.file, query ? { query } : undefined)
  return loading.catch(() => undefined)
}

// ---------------------------------------------------------------------------
// 文案、对话框
// ---------------------------------------------------------------------------

type Text = (key: TranslationKey, params?: Record<string, string | number>) => string
function recoveryText(locale: Locale): Text {
  return (key, params) =>
    (allMessages[key] as { zh: string; en: string })[locale === 'en-US' ? 'en' : 'zh'].replace(
      /\{(\w+)\}/g,
      (_, name: string) => String(params?.[name] ?? ''),
    )
}

export type RecoveryChoice = 'reload' | 'logs' | 'quit'
export interface CrashInfo {
  reason: string
  exitCode?: number
  n: number
}

/** 弹之前先把窗口显示出来：它可能按设置隐藏在托盘里，看不见的模态对话框会让窗口一直白着 */
function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

async function promptRecovery(win: BrowserWindow, info: CrashInfo): Promise<RecoveryChoice> {
  const t = recoveryText(windowLocale(win))
  const reason =
    info.reason === 'oom'
      ? t('recovery.reason.oom')
      : t('recovery.reason.other', {
          code: info.exitCode === undefined ? info.reason : `${info.reason} ${info.exitCode}`,
        })
  showWindow(win)
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: t('recovery.dialog.title'),
    message: t('recovery.dialog.message', { n: info.n, reason }),
    detail: t('recovery.dialog.detail'),
    buttons: [t('recovery.dialog.reload'), t('recovery.dialog.openLogs'), t('recovery.dialog.quit')],
    defaultId: 0,
    // Esc 或关掉对话框：什么都不做窗口会一直白着，所以当作重新加载
    cancelId: 0,
    noLink: true,
  })
  return response === 1 ? 'logs' : response === 2 ? 'quit' : 'reload'
}

// ---------------------------------------------------------------------------
// 监听
// ---------------------------------------------------------------------------

export interface CrashDeps {
  /** 重新加载应用页面（index.ts 的 loadApp 包一层带上地址） */
  load: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
  openLogs: () => Promise<void> | void
  quit: () => void
  /** 默认弹系统对话框 */
  prompt?: (win: BrowserWindow, info: CrashInfo) => Promise<RecoveryChoice>
}

/** 挂在主窗口上：渲染进程退出、恢复中加载失败都按 recoveryStep 处理 */
export function watchCrashes(win: BrowserWindow, deps: CrashDeps): void {
  const wc = win.webContents
  const prompt = deps.prompt ?? promptRecovery
  let times: number[] = []
  let timer: NodeJS.Timeout | null = null
  let loadTimer: NodeJS.Timeout | null = null
  let asking = false
  // 对话框开着时又崩：只更新这份，用户选「重新加载」时用最新的 n 和 reason
  let pending: CrashInfo | null = null

  const clearLoadTimer = (): void => {
    if (loadTimer) clearTimeout(loadTimer)
    loadTimer = null
  }
  const reload = (reason: string, n: number): void => {
    if (win.isDestroyed()) return
    clearLoadTimer()
    void deps.load(win, { recovered: reason, n: String(n) })
    loadTimer = setTimeout(() => {
      loadTimer = null
      if (win.isDestroyed() || !isRecovering(wc)) return
      log.warn('界面重新加载超时', { ms: LOAD_TIMEOUT_MS, n: times.length })
      crashed('load-timeout')
    }, LOAD_TIMEOUT_MS)
    loadTimer.unref?.()
  }
  const ask = async (first: CrashInfo): Promise<void> => {
    pending = first
    if (asking) return
    asking = true
    let info = first
    log.warn('界面反复退出，等用户选择', { reason: info.reason, n: info.n })
    try {
      while (!win.isDestroyed()) {
        info = pending ?? info
        const choice = await prompt(win, info)
        if (win.isDestroyed()) return
        info = pending ?? info
        log.info('界面反复退出，用户选择', { choice })
        if (choice === 'logs') {
          await deps.openLogs()
          // 再弹一次同一个对话框，不然窗口一直是白的，用户没有下一步
          continue
        }
        if (choice === 'quit') deps.quit()
        else reload(info.reason, info.n)
        return
      }
    } finally {
      asking = false
      pending = null
    }
  }
  const crashed = (reason: string, exitCode?: number): void => {
    markRecovering(wc)
    if (timer) clearTimeout(timer)
    timer = null
    clearLoadTimer()
    const step = recoveryStep(times, Date.now())
    times = step.times
    if (step.action.kind === 'ask') {
      void ask({ reason, exitCode, n: step.n })
      return
    }
    const { delayMs } = step.action
    log.info('界面自动重新加载', { reason, n: step.n, delayMs })
    timer = setTimeout(() => {
      timer = null
      reload(reason, step.n)
    }, delayMs)
  }

  wc.on('did-finish-load', clearLoadTimer)
  wc.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') crashed(details.reason, details.exitCode)
  })
  wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return
    clearLoadTimer()
    // 第一次启动时失败：只记，不自动重试
    if (!isRecovering(wc)) {
      log.warn('界面加载失败', { errorCode, errorDescription })
      return
    }
    log.warn('界面重新加载失败', { errorCode, errorDescription, n: times.length })
    crashed('load-failed', errorCode)
  })
  win.on('closed', () => {
    if (timer) clearTimeout(timer)
    timer = null
    clearLoadTimer()
  })
}
