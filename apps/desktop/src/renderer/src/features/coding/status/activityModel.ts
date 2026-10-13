// 状态栏「AI 正在做什么」的文字（纯逻辑）：组合规则照 session/live/TurnProcess.tsx 的 useActivity
import type { Item } from '@pixelsky/protocol'
import { tr } from '../../../i18n/core'
import {
  STEP_CLOCK_MS,
  WAIT_CLOCK_MS,
  clockText,
  currentStep,
  stepText,
  waitingFor,
} from '../../session/live/currentStep'

export interface Activity {
  /** 例：运行 npm run typecheck · 12s */
  text: string
  /** 当前这一步的条目 id；两步之间等待时是 null（点了只切到对话） */
  itemId: string | null
  /** 计时用的键：同一步 / 同一段等待里不变 */
  key: string
}

/** 当前这一步 / 等待的计时键；没有活动时为 null（给 useSince 用） */
export function activityKey(items: readonly Item[], running: boolean, live: boolean = running): string | null {
  if (!running) return null
  const step = currentStep(items)
  if (step) return `step:${step.item.id}`
  const last = items[items.length - 1]
  if (last?.kind === 'assistant' && last.status === 'running') return null
  if (!live) return null
  return `wait:${last?.id ?? ''}:${waitingFor(items)}`
}

/**
 * 运行中返回现在在干什么：有在跑的一步写这一步（超过 3 秒带用时、并行的写「等 N 项」）；
 * 两步之间写在等什么（超过 5 秒带已等的时间）。没在运行、正在输出文字、等你批准时返回 null
 */
export function activityText(
  items: readonly Item[],
  running: boolean,
  sinceMs: number,
  live: boolean = running,
  long: (ms: number) => string = ms => `${Math.floor(ms / 1000)}s`,
): Activity | null {
  const key = activityKey(items, running, live)
  if (!key) return null
  const step = currentStep(items)
  if (step) {
    const parts = [stepText(step.item)]
    if (step.more > 0) parts.push(tr('session.step.more', { n: step.more }))
    if (sinceMs >= STEP_CLOCK_MS) parts.push(clockText(sinceMs, long))
    return { text: parts.join(' · '), itemId: step.item.id, key }
  }
  const text = tr(`session.wait.${waitingFor(items)}`)
  return { text: sinceMs >= WAIT_CLOCK_MS ? `${text} · ${clockText(sinceMs, long)}` : text, itemId: null, key }
}
