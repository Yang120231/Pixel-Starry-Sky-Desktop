// 桌面界面不再常驻图片原图（docs/perf-audit-2026-10-18.md B1）：发给桌面窗口的条目事件里，
// 用户发的图、工具结果里的图把 dataBase64 换成空串（名字、大小、宽高保留），界面显示、复制、重发时按需经 engine:image 取。
// 实测界面快照里的图片有 174 MB，是界面内存里最大的一块。「打开会话」的快照在宿主里就截过了（cutItem，docs/session-memory.md）；
// 事件里的条目是完整的，手机走自己的 slimForPhone。这里只做浅拷贝，不改原对象
import type { HostEvent, ImageAttachment, Item } from '@pixelsky/protocol'

const blank = (images: ImageAttachment[]): ImageAttachment[] =>
  images.map(image => (image.dataBase64 ? { ...image, dataBase64: '' } : image))

/** 一条条目去掉图片数据；没有图片数据的原样返回 */
export function itemWithoutImageData(item: Item): Item {
  if (item.kind === 'user' && item.attachments?.some(a => a.dataBase64))
    return { ...item, attachments: blank(item.attachments) }
  if (item.kind === 'tool' && item.images?.some(a => a.dataBase64)) return { ...item, images: blank(item.images) }
  return item
}

/** 推给桌面窗口的事件：条目开始 / 完成、整份换掉时去掉图片数据，别的原样 */
export function eventForDesktop(event: HostEvent): HostEvent {
  if (event.kind !== 'session') return event
  const e = event.event
  if (e.type === 'item_started' || e.type === 'item_completed') {
    const item = itemWithoutImageData(e.item)
    return item === e.item ? event : { ...event, event: { ...e, item } }
  }
  if (e.type === 'items_reset') {
    const items = e.items.map(itemWithoutImageData)
    return items.every((item, i) => item === e.items[i]) ? event : { ...event, event: { ...e, items } }
  }
  return event
}

/** 一张图的原图：用户发的图、工具结果里的图，按图片 id 找（手机按第几张）；找不到为 null。item 要是补过图片数据的（EngineHost.item） */
export function imageOf(item: Item | null, imageId: string | number): ImageAttachment | null {
  const images = item?.kind === 'user' ? item.attachments : item?.kind === 'tool' ? item.images : undefined
  const image = typeof imageId === 'number' ? images?.[imageId] : images?.find(image => image.id === imageId)
  return image?.dataBase64 ? image : null
}
