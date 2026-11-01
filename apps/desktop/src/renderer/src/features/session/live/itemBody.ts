// 截过的长输出按需取完整的一条（docs/session-memory.md 第 3 期）：快照里命令 / 工具的 output 只留头尾（cutChars），
// 展开、复制、搜索折叠内容时按 会话 + 条目 id 向主进程要（engine:item），只留最近几条；写法同 attachments/imageSource.ts
import { useContext, useEffect, useRef, useState } from 'react'
import { withBodies, type Item } from '@pixelsky/protocol'
import { isDemo } from '@/data'
import { ImageSessionContext } from '../attachments/imageSource'

const RECENT_LIMIT = 16
/** 键 会话|id；cut 是取的时候那条截过的，换了内容就不算命中 */
const recent = new Map<string, { cut: Item; full: Item }>()
const loading = new Map<string, { cut: Item; job: Promise<Item> }>()

/** 同一条截过的：同一个对象，或截下的头尾和原长度都一样（重新打开会话、条目更新后对象会换） */
const same = (a: Item, b: Item): boolean =>
  a === b || (a.cutChars === b.cutChars && 'output' in a && 'output' in b && a.output === b.output)

/** 最近取过的完整版本（不发请求、不调整次序）；没有为 null */
export function cachedItem(item: Item, sessionId: string | null | undefined): Item | null {
  const hit = sessionId ? recent.get(`${sessionId}|${item.id}`) : undefined
  return hit && same(hit.cut, item) ? hit.full : null
}

/** 完整的一条：输出没截过的原样返回；否则按需取（同一条同时只取一次），取不到返回截过的那条 */
export function fullItem(item: Item, sessionId: string | null | undefined): Promise<Item> {
  if (item.cutChars === undefined) return Promise.resolve(item)
  const bridge = isDemo ? undefined : window.pixelsky?.engine
  if (!sessionId || !bridge) return Promise.resolve(item)
  const key = `${sessionId}|${item.id}`
  const hit = recent.get(key)
  if (hit && same(hit.cut, item)) {
    recent.delete(key)
    recent.set(key, hit)
    return Promise.resolve(hit.full)
  }
  const running = loading.get(key)
  if (running && same(running.cut, item)) return running.job
  const job: Promise<Item> = bridge
    .item(sessionId, item.id)
    .then(got => {
      // 磁盘读失败时主进程退回截过的那条（还带 cutChars），当作取不到
      if (!got || got.cutChars !== undefined || got.kind !== item.kind) return item
      // 其它字段仍取界面里这条，只补回输出
      const full = withBodies(item, got)
      recent.delete(key)
      recent.set(key, { cut: item, full })
      while (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value!)
      return full
    })
    .catch(() => item)
    .finally(() => {
      if (loading.get(key)?.job === job) loading.delete(key)
    })
  loading.set(key, { cut: item, job })
  return job
}

/**
 * want 为真时用完整的一条（会话 id 取 ImageSessionContext）；取到前用最近取过的、同 id 上一个没截过的版本
 * （刚跑完的命令截成头尾后不闪一下），都没有就用截过的。want 为假、没截过时原样返回
 */
export function useItemBody<T extends Item | undefined>(item: T, want: boolean): T {
  const sessionId = useContext(ImageSessionContext)
  const [got, setGot] = useState<{ cut: Item; full: Item } | null>(null)
  const whole = useRef<Item | null>(null)
  // 收起时放掉；Claude 跑着时输出是空的，空版本不如头尾，不记
  if (!want) whole.current = null
  else if (item && item.cutChars === undefined && 'output' in item && item.output) whole.current = item
  const cut = want && item?.cutChars !== undefined ? item : undefined
  useEffect(() => {
    if (!cut) {
      // 收起了：取到的完整内容也放掉（再展开时先用最近 16 条的缓存）
      setGot(null)
      return
    }
    let alive = true
    void fullItem(cut, sessionId).then(full => alive && setGot({ cut, full }))
    return () => {
      alive = false
    }
  }, [cut, sessionId])
  if (!cut) return item
  if (got?.cut === cut) {
    // 完整的到了：跑着时那份不用再留（同一段长输出不存两份）
    whole.current = null
    return got.full as T
  }
  const before = cachedItem(cut, sessionId) ?? (got?.full.id === cut.id ? got.full : whole.current)
  return (before?.id === cut.id ? before : cut) as T
}
