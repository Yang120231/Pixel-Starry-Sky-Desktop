// 「需要你」的界面数据（docs/ui/channels-collab-v2.md §2）：正式模式用主进程推来的，演示模式按演示消息现算；
// 「稍后处理」记在本机（localStorage），到点或这件事的状态变了就重新出现
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ChannelFollow, ChannelNeed } from '../../../../shared/types/channels'
import { channelNeeds } from '../../../../shared/channels/needs'
import { channelsLive, selfIdIn, useChannels } from './store'

const KEY = 'pixelsky.channels.snooze'

type Snoozes = Record<string, { until: number; sig: string }>

function read(): Snoozes {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Snoozes
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

let snoozes: Snoozes = typeof localStorage !== 'undefined' ? read() : {}
const listeners = new Set<() => void>()

/** 稍后处理到 until；sig 是现在的状态 */
export function snooze(need: Pick<ChannelNeed, 'key' | 'sig'>, until: number): void {
  const now = Date.now()
  // 顺手清掉过期的
  snoozes = Object.fromEntries(Object.entries(snoozes).filter(([, v]) => v.until > now))
  snoozes[need.key] = { until, sig: need.sig }
  try {
    localStorage.setItem(KEY, JSON.stringify(snoozes))
  } catch {
    /* 存不了就只在这次有效 */
  }
  for (const l of listeners) l()
}

/** 「稍后处理」的两个时间：1 小时后、明天 9 点 */
export function snoozeTimes(now = Date.now()): { hour: number; tomorrow: number } {
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  t.setHours(9, 0, 0, 0)
  return { hour: now + 3_600_000, tomorrow: t.getTime() }
}

/** 这件事现在要不要显示：没稍后处理、已经到点、或状态变了 */
export function visibleNeed(need: ChannelNeed, all: Snoozes, now: number): boolean {
  const s = all[need.key]
  return !s || s.until <= now || s.sig !== need.sig
}

const NO_NEEDS: ChannelNeed[] = []
const NO_FOLLOWING: ChannelFollow[] = []

/**
 * needs：等你处理的（去掉稍后处理的和找不到目标的，侧栏数字按它算）；gone：找不到目标的（折叠成一组，§2.1）；
 * done：标为已处理的；snoozed：稍后处理了几件；following：跟进中的
 */
export function useNeeds(): {
  needs: ChannelNeed[]
  gone: ChannelNeed[]
  done: ChannelNeed[]
  snoozed: number
  following: ChannelFollow[]
} {
  const live = useChannels(s => (channelsLive ? s.needs : NO_NEEDS))
  const liveDone = useChannels(s => (channelsLive ? s.needsDone : NO_NEEDS))
  const liveFollowing = useChannels(s => (channelsLive ? s.following : NO_FOLLOWING))
  const channels = useChannels(s => s.channels)
  const messages = useChannels(s => s.messages)
  const marks = useChannels(s => s.demoMarks)
  const members = useChannels(s => s.members)
  const self = useChannels(s => selfIdIn(s, undefined))
  // 演示模式：按演示数据里的消息现算（团队频道不算）；演示数据里没有会话列表，只按成员在不在判断找不到目标
  const demo = useMemo(
    () =>
      channelsLive
        ? null
        : channelNeeds(
            channels.filter(c => c.scope === 'local').map(c => ({ ...c, needsDone: marks[c.id] })),
            new Map(Object.entries(messages)),
            self ?? '',
            n => (n.memberId && !members.some(m => m.id === n.memberId) ? 'member' : null),
          ),
    [channels, messages, self, marks, members],
  )
  const all = useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snoozes,
  )
  const [now, setNow] = useState(Date.now)
  const source = demo?.needs ?? live
  // 最早的那个稍后处理到点时刷新一次
  useEffect(() => {
    const next = Math.min(...source.map(n => all[n.key]?.until ?? Infinity).filter(t => t > now), Infinity)
    if (next === Infinity) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - Date.now() + 50, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [source, all, now])
  return useMemo(() => {
    const visible = source.filter(n => visibleNeed(n, all, now))
    return {
      needs: visible.filter(n => !n.gone),
      gone: visible.filter(n => !!n.gone),
      done: demo?.done ?? liveDone,
      snoozed: source.length - visible.length,
      following: demo?.following ?? liveFollowing,
    }
  }, [source, all, now, demo, liveDone, liveFollowing])
}
