import type { StreamBlocks } from './streamBlocks'

/** 流式的尾巴超过这么多字就不再每帧重新解析（长尾巴每次解析、排版、代码高亮都很重） */
export const TAIL_SLOW_CHARS = 4000
/** 尾巴很长时最多隔这么久刷新一次 */
export const TAIL_SLOW_MS = 200
/** 动画档位为流畅时：上一次刷新渲染不到这么久就不等，每次都跟上最新 */
export const TAIL_FAST_MS = 8
/** 流畅档渲染慢时，间隔是渲染耗时的这么多倍（渲染最多占主线程约 1/5），最多 TAIL_SLOW_MS */
const TAIL_GAP_RATIO = 4

/** 动画档位为流畅（<html data-perf="smooth">，features/layout/perfTier.ts）：长尾巴按渲染耗时定间隔 */
const smoothTier = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.perf === 'smooth'

export interface TailThrottle {
  /** 渲染时调用：传入最新的切块结果，返回此刻该显示的（可能是稍早的）一份；总是某一时刻完整的 completed + tail，不会重复或缺字 */
  view(latest: StreamBlocks): StreamBlocks
  /** 渲染提交后（layout effect）调用：量这次刷新的渲染耗时；该延后刷新而还没排定时间的，排一个定时器 */
  arm(): void
  /** 卸载 / 重新挂载时清掉定时器 */
  dispose(): void
}

/**
 * 流式尾巴的节流。显示出来的尾巴不超过 TAIL_SLOW_CHARS 时每次都跟上最新（每帧一次，和原来一样）；
 * 超过后：省电档最多每 TAIL_SLOW_MS 刷新一次；流畅档看上一次刷新渲染用了多久，不到 TAIL_FAST_MS 就每次跟上，
 * 慢了间隔取渲染耗时的 TAIL_GAP_RATIO 倍（最多 TAIL_SLOW_MS），又快了就回到每次跟上。
 * 下面几种情况立刻同步刷新，免得显示出旧内容：
 * 已写完的块数变了（有块写完、尾巴从头开始）、尾巴不是在显示的尾巴后面接着写（变短、换了内容）。
 * 流式结束时整条换成完整渲染，不经过这里，也不会丢字。
 * onDue：定时器到点，要求调用方重新渲染一次（下一次 view 直接取最新）；smooth：当前是不是流畅档
 */
export function createTailThrottle(onDue: () => void, smooth: () => boolean = smoothTier): TailThrottle {
  let shown: StreamBlocks | null = null
  let pending = false
  let due = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 上一次刷新的时刻；这次刷新开始渲染的时刻（arm 时量耗时，没刷新为 null） */
  let shownAt = 0
  let renderFrom: number | null = null
  /** 流畅档的间隔 */
  let gap = 0
  const clear = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return {
    view(latest) {
      const fast = smooth()
      const now = fast ? performance.now() : 0
      const flush =
        !shown ||
        due ||
        shown.tail.length <= TAIL_SLOW_CHARS ||
        (fast && now - shownAt >= gap) ||
        latest.completed.length !== shown.completed.length ||
        !latest.tail.startsWith(shown.tail)
      if (flush) {
        if (fast && latest !== shown) {
          shownAt = now
          renderFrom = now
        }
        shown = latest
        pending = false
        due = false
        clear()
      } else if (latest !== shown) {
        pending = true
      }
      return shown!
    },
    arm() {
      const fast = smooth()
      if (fast && renderFrom !== null) {
        const cost = performance.now() - renderFrom
        gap = cost < TAIL_FAST_MS ? 0 : Math.min(TAIL_SLOW_MS, cost * TAIL_GAP_RATIO)
      }
      renderFrom = null
      if (pending && !timer) {
        const wait = fast ? Math.max(0, gap - (performance.now() - shownAt)) : TAIL_SLOW_MS
        timer = setTimeout(() => {
          timer = null
          due = true
          onDue()
        }, wait)
      }
    },
    dispose: clear,
  }
}
