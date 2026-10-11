// 给手机的会话快照（docs/mobile-remote.md §5.2、§11.1）：只取最后一段条目，去掉图片、截断长文本。
// 纯函数，本机和 SSH 辅助进程共用；手机点开某一条时再用 itemDetail 取完整内容。
import type { OpenedSession, SessionSnapshot } from '@pixelsky/protocol'
import { int } from '../args'
import type { ItemDetail, SessionTail } from '../../../shared/types/mobile'

export type { SessionTail } from '../../../shared/types/mobile'

export interface TailOptions {
  limit: number
  before: string | null
  maxBytes: number
}

/** M0 实测：60 条、明文 128 KB、字符串 4 KB */
const DEFAULT_LIMIT = 60
const MAX_LIMIT = 200
const DEFAULT_BYTES = 128 * 1024
const STRING_CUT = 4096
/** 手机单帧最多 1 MB，单条完整内容留出余量 */
const DETAIL_CUT = 256 * 1024
const DETAIL_BYTES = 800 * 1024

export function tailOptions(raw: unknown): TailOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    limit: Math.max(1, int(o.limit, DEFAULT_LIMIT, MAX_LIMIT)),
    before: typeof o.before === 'string' && o.before ? o.before : null,
    maxBytes: DEFAULT_BYTES,
  }
}

/** 去掉图片的 base64、把长字符串截到 cut；hit 在发生截断时置真 */
function slim<T>(value: T, cut: number, hit: { cut: boolean }, keepImages = false): T {
  if (typeof value === 'string') {
    if (value.length <= cut) return value
    hit.cut = true
    return value.slice(0, cut) as T
  }
  if (Array.isArray(value)) return value.map(v => slim(v, cut, hit, keepImages)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (key === 'dataBase64' && typeof v === 'string') {
        // 图片要么整张带上，要么换成占位（bytes / width / height 等字段保留，手机显示尺寸，点开再取）；不截断
        if (v && !keepImages) hit.cut = true
        out[key] = keepImages ? v : ''
      } else out[key] = slim(v, cut, hit, keepImages)
    }
    return out as T
  }
  return value
}

const size = (value: unknown): number => JSON.stringify(value)?.length ?? 0

/** 推给手机的事件同样去掉图片、截断长文本（单帧 1 MB，和 sessionTail 的条目一致） */
export function slimForPhone<T>(value: T): T {
  return slim(value, STRING_CUT, { cut: false })
}

export function sessionTail(opened: OpenedSession, options: TailOptions): SessionTail {
  const { items, ...rest } = opened.snapshot
  let end = items.length
  if (options.before) {
    const index = items.findIndex(item => item.id === options.before)
    end = index >= 0 ? index : items.length
  }
  const window: typeof items = []
  const truncated: string[] = []
  let bytes = 0
  for (let i = end - 1; i >= 0 && window.length < options.limit; i--) {
    const hit = { cut: false }
    const item = slim(items[i], STRING_CUT, hit)
    const itemBytes = size(item)
    // 至少给一条，之后超过字节上限就停
    if (window.length > 0 && bytes + itemBytes > options.maxBytes) break
    bytes += itemBytes
    window.push(item)
    if (hit.cut) truncated.push(item.id)
  }
  window.reverse()
  const start = end - window.length
  const other = slim(rest, STRING_CUT, { cut: false })
  return {
    snapshot: { ...other, items: window } as SessionSnapshot,
    seq: opened.seq,
    total: items.length,
    before: start > 0 ? window[0].id : null,
    truncated: truncated.reverse(),
  }
}

/** 一条的完整内容：长文本放宽到 256 KB；图片放得下才带上（单帧 1 MB） */
export function itemDetail(snapshot: SessionSnapshot, itemId: string): ItemDetail | null {
  const item = snapshot.items.find(i => i.id === itemId)
  if (!item) return null
  const hit = { cut: false }
  const full = slim(item, DETAIL_CUT, hit, true)
  if (size(full) <= DETAIL_BYTES) return { item: full, truncated: hit.cut }
  const noImages = { cut: hit.cut }
  return { item: slim(item, DETAIL_CUT, noImages), truncated: noImages.cut }
}
