// 卡顿诊断（docs/ui/logging.md §4.9）：窗口没响应、主进程被占住、内存涨得很高时写进本机日志，
// 下次卡死能从日志看出卡在哪一边、卡在哪段代码。用户卡住后多半直接结束进程，所以窗口没响应的记录马上同步写盘。
import { app, powerMonitor, type BrowserWindow, type Session } from 'electron'
import { logger } from '@pixelsky/engine'
import { ipcInFlight } from '../ipc/guard'
import { logService } from './logging'

const log = logger('perf')

/** 页面声明了这条 Document-Policy，主进程才能取到它正在跑的 JS 调用栈（还要打开下面的 Chromium 开关） */
const CALL_STACK_POLICY = 'include-js-call-stacks-in-crash-reports'
const CALL_STACK_FEATURE = 'DocumentPolicyIncludeJSCallStacksInCrashReports'
/** 取调用栈最多等这么久：页面里没有 JS 在跑时它一直不返回 */
const STACK_TIMEOUT_MS = 3_000
const STACK_LINES = 25
/** 窗口一直没响应时，隔这么久再记一次（看内存和调用栈有没有变），最多记这么多次 */
const REPEAT_MS = 30_000
const MAX_REPEATS = 10

/** 主进程计时器每秒跳一次，晚到超过这么久算卡住 */
const TICK_MS = 1_000
const LAG_MS = 2_000

/** 进程内存每分钟看一次；超过 1.5 GB 记一条，之后每再涨 512 MB 记一条，回落到 1 GB 以下重新开始 */
const MEMORY_EVERY_MS = 60_000
export const MEMORY_WARN_MB = 1_536
export const MEMORY_STEP_MB = 512

const mb = (kb: number): number => Math.round(kb / 1024)

/** 在 app ready 之前调用：打开取调用栈要用的 Chromium 开关（目前没有别处设 enable-features） */
export function enableCallStacks(): void {
  app.commandLine.appendSwitch('enable-features', CALL_STACK_FEATURE)
}

/** 应用自己的页面加上 Document-Policy 响应头（本地文件也会经过这里）；只动顶层页面 */
export function allowCallStacks(session: Session, isAppUrl: (url: string) => boolean): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame' || !isAppUrl(details.url)) return callback({})
    callback({ responseHeaders: { ...details.responseHeaders, 'Document-Policy': [CALL_STACK_POLICY] } })
  })
}

/** 某个进程的内存（MB）；进程已经没了时为 null */
function processMemory(pid: number): { workingSetMb: number; privateMb?: number } | null {
  const memory = app.getAppMetrics().find(p => p.pid === pid)?.memory
  if (!memory) return null
  return {
    workingSetMb: mb(memory.workingSetSize),
    ...(memory.privateBytes !== undefined ? { privateMb: mb(memory.privateBytes) } : {}),
  }
}

/** 调用栈只留前几行；拿不到时为 null */
export function trimStack(stack: string | void): string | null {
  const text = stack?.trim()
  return text ? text.split('\n').slice(0, STACK_LINES).join('\n') : null
}

async function callStack(win: BrowserWindow): Promise<string | null> {
  try {
    const stack = await Promise.race([
      win.webContents.mainFrame.collectJavaScriptCallStack(),
      new Promise<void>(resolve => setTimeout(resolve, STACK_TIMEOUT_MS).unref()),
    ])
    return trimStack(stack)
  } catch {
    return null
  }
}

/** 窗口没响应、恢复响应时记日志；带上离上次切回窗口多久、页面进程的内存和正在跑的 JS 调用栈 */
export function watchWindow(win: BrowserWindow): void {
  const at: { focus?: number; blur?: number; restore?: number; show?: number } = {}
  win.on('focus', () => (at.focus = Date.now()))
  win.on('blur', () => (at.blur = Date.now()))
  win.on('restore', () => (at.restore = Date.now()))
  win.on('show', () => (at.show = Date.now()))
  let since: number | null = null
  let repeat: NodeJS.Timeout | null = null
  const stop = (): void => {
    if (repeat) clearInterval(repeat)
    repeat = null
    since = null
  }
  const ago = (t: number | undefined, now: number): number | null => (t === undefined ? null : now - t)

  const report = async (message: string): Promise<void> => {
    if (since === null || win.isDestroyed()) return
    const started = since
    const stack = await callStack(win)
    if (since !== started || win.isDestroyed()) return
    const now = Date.now()
    log.warn(message, {
      window: win.id,
      // 从 Chromium 判定没响应算起（它要等输入十几秒没有回应才判定，实际卡住比这更久）
      unresponsiveMs: now - started,
      focused: win.isFocused(),
      minimized: win.isMinimized(),
      visible: win.isVisible(),
      sinceFocusMs: ago(at.focus, now),
      sinceBlurMs: ago(at.blur, now),
      sinceRestoreMs: ago(at.restore ?? at.show, now),
      memory: processMemory(win.webContents.getOSProcessId()),
      ...(stack ? { stack } : {}),
    })
    logService()?.flushSync()
  }

  win.on('unresponsive', () => {
    if (since !== null) return
    since = Date.now()
    void report('窗口没有响应')
    let count = 0
    repeat = setInterval(() => {
      if (++count >= MAX_REPEATS && repeat) clearInterval(repeat)
      void report('窗口仍然没有响应')
    }, REPEAT_MS)
    repeat.unref()
  })
  win.on('responsive', () => {
    if (since === null) return
    log.info('窗口恢复响应', { window: win.id, unresponsiveMs: Date.now() - since })
    stop()
  })
  win.on('closed', stop)
}

/** 计时器晚到多少毫秒算主进程卡住；刚睡眠唤醒的不算 */
export function mainLag(lateMs: number, sleeping: boolean): number | null {
  return !sleeping && lateMs >= LAG_MS ? Math.round(lateMs) : null
}

/** 主进程卡住（计时器晚到 2 秒以上）时记一条，带上那会儿还没处理完的 IPC 请求 */
export function watchMainLoop(): void {
  let expected = performance.now() + TICK_MS
  // 睡眠期间计时器也停着，醒来第一跳会晚很久：从睡下到醒来后几秒内都不算
  let sleeping = false
  let wokeAt = -Infinity
  powerMonitor.on('suspend', () => (sleeping = true))
  powerMonitor.on('resume', () => {
    sleeping = false
    wokeAt = performance.now()
  })
  setInterval(() => {
    const now = performance.now()
    const lag = mainLag(now - expected, sleeping || now - wokeAt < TICK_MS * 5)
    expected = now + TICK_MS
    if (lag !== null) log.warn('主进程卡住', { lagMs: lag, ipc: ipcInFlight() })
  }, TICK_MS).unref()
}

/** 内存到了第几档：0 是没到 1.5 GB，1 是 1.5 GB 起，之后每 512 MB 一档 */
export function memoryLevel(workingSetMb: number): number {
  return workingSetMb < MEMORY_WARN_MB ? 0 : Math.floor((workingSetMb - MEMORY_WARN_MB) / MEMORY_STEP_MB) + 1
}

/** 每分钟看一次各进程的内存，涨到新的一档就记一条 */
export function watchMemory(): void {
  const logged = new Map<number, number>()
  setInterval(() => {
    const alive = new Set<number>()
    for (const p of app.getAppMetrics()) {
      alive.add(p.pid)
      const workingSetMb = mb(p.memory.workingSetSize)
      const level = memoryLevel(workingSetMb)
      const before = logged.get(p.pid) ?? 0
      if (level > before) {
        logged.set(p.pid, level)
        log.warn('内存占用高', {
          type: p.type,
          ...(p.name ? { name: p.name } : {}),
          ...(p.serviceName ? { serviceName: p.serviceName } : {}),
          pid: p.pid,
          workingSetMb,
          ...(p.memory.privateBytes !== undefined ? { privateMb: mb(p.memory.privateBytes) } : {}),
        })
      } else if (workingSetMb < MEMORY_WARN_MB - MEMORY_STEP_MB) logged.delete(p.pid)
    }
    for (const pid of logged.keys()) if (!alive.has(pid)) logged.delete(pid)
  }, MEMORY_EVERY_MS).unref()
}
