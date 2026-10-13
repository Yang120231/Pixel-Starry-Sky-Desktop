// 快照占多大（docs/ui/renderer-memory.md §3.2.1）：内存遥测用，只数字符串长度，不序列化
import type { SessionSnapshot } from '@pixelsky/protocol'

export interface SnapshotStats {
  snapshots: number
  items: number
  /** 字符串长度之和（不含 dataBase64），字符数 */
  textChars: number
  /** 所有 dataBase64 的长度之和 */
  imageChars: number
}

type Counter = { text: number; image: number }

/** 一个对象的字符串字段：键名 dataBase64 算图片，其余算文字 */
function countFields(obj: Record<string, unknown>, into: Counter): void {
  for (const key in obj) {
    const v = obj[key]
    if (typeof v !== 'string') continue
    if (key === 'dataBase64') into.image += v.length
    else into.text += v.length
  }
}

/** 一次 O(条目数)：条目本身，加 attachments / images / files 数组里的对象（只下两层） */
export function snapshotStats(snapshots: Record<string, Pick<SessionSnapshot, 'items'>>): SnapshotStats {
  const sum: Counter = { text: 0, image: 0 }
  let count = 0
  let items = 0
  for (const id in snapshots) {
    count++
    for (const item of snapshots[id].items as unknown as Array<Record<string, unknown>>) {
      items++
      countFields(item, sum)
      for (const key of ['attachments', 'images', 'files']) {
        const list = item[key]
        if (!Array.isArray(list)) continue
        for (const child of list)
          if (child && typeof child === 'object') countFields(child as Record<string, unknown>, sum)
      }
    }
  }
  return { snapshots: count, items, textChars: sum.text, imageChars: sum.image }
}
