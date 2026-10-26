// 切换对话的耗时（docs/ui/performance.md §5.2 B1）：从点击 / 按键到新对话画出来超过 100 毫秒，记一条 warn。
// 只量用户操作引起的切换：标签变成当前标签前 1 秒内没有点击、按键（启动恢复标签、程序自己切的）不量。
// 分段：commitMs 点击到标签切过来的提交，loadMs 等主进程读出对话快照（已有快照的不记），totalMs 到快照到手后的下一帧。
import { getEngineState, subscribeEngine } from '@/features/engine/store'

const SLOW_MS = 100
const INPUT_WINDOW_MS = 1_000
/** 等快照最多等这么久，超过就不量了（读失败、会话被删） */
const LOAD_TIMEOUT_MS = 15_000

let lastInput = -Infinity

/** 起点：1 秒内有过点击、按键就从那一刻算，否则不量（null） */
export const switchStart = (now: number, input: number): number | null =>
  now - input <= INPUT_WINDOW_MS ? input : null

/** 接下来的标签切换不是用户在切对话（欢迎页发第一条消息、建好会话后换成会话标签）：不量，免得把建会话的时间算进去 */
export function forgetInput(): void {
  lastInput = -Infinity
}

export function installInputClock(): void {
  const note = (e: Event): void => {
    lastInput = e.timeStamp
  }
  window.addEventListener('pointerdown', note, { capture: true, passive: true })
  window.addEventListener('keydown', note, { capture: true, passive: true })
}

const round = (ms: number): number => Math.round(ms)

/** 对话标签变成当前标签时（提交阶段）调用；cold：内容是这次才挂载的（没保活着） */
export function noteSessionSwitch(sessionId: string, cold: boolean): void {
  const bridge = window.pixelsky?.log
  if (!bridge) return
  const commit = performance.now()
  const start = switchStart(commit, lastInput)
  if (start === null) return
  const items = (): number | undefined => getEngineState().snapshots[sessionId]?.items.length
  const done = (loadMs: number | null): void => {
    // 下一帧画完：rAF 在绘制前，再排一个任务就到了绘制之后
    requestAnimationFrame(() =>
      setTimeout(() => {
        const totalMs = performance.now() - start
        if (totalMs < SLOW_MS) return
        bridge.write('warn', '切换会话慢', {
          totalMs: round(totalMs),
          commitMs: round(commit - start),
          ...(loadMs !== null ? { loadMs } : {}),
          cold,
          items: items() ?? null,
        })
      }),
    )
  }
  if (items() !== undefined) return done(null)
  const unsubscribe = subscribeEngine(() => {
    if (items() === undefined) return
    stop()
    done(round(performance.now() - commit))
  })
  const timer = setTimeout(() => stop(), LOAD_TIMEOUT_MS)
  const stop = (): void => {
    clearTimeout(timer)
    unsubscribe()
  }
}
